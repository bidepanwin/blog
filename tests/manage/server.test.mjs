import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { splitDocument } from "../../scripts/manage/documents.mjs";
import { createManagerServer } from "../../scripts/manage/server.mjs";

const examplePath = "src/content/posts/example.md";
const example =
	"---\ntitle: Example\npublished: 2026-11-14\ndraft: true\ncustom: retained\n---\n\nOriginal body\n";

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "shirone-manager-server-"));
	await mkdir(path.join(root, "src/config"), { recursive: true });
	await mkdir(path.join(root, "src/content/posts"), { recursive: true });
	await mkdir(path.join(root, ".git"), { recursive: true });
	await writeFile(
		path.join(root, "src/config/siteConfig.ts"),
		'export const siteConfig = { site: "https://example.test/blog/", base: "/blog/", timeZone: "Asia/Shanghai" };\n',
	);
	await writeFile(path.join(root, examplePath), example);
	await writeFile(
		path.join(root, ".env"),
		"PRIVATE_SENTINEL=must-not-be-returned",
	);
	await writeFile(path.join(root, ".git/config"), "PRIVATE_GIT_SENTINEL");
	const recorded = [];
	const jobs = {
		isRunning: () => false,
		record: async (...args) => recorded.push(args),
		gitState: async () => ({
			branch: "main",
			changed: [],
			ahead: 0,
			behind: 0,
		}),
		get: () => null,
		start: () => ({ id: "mock-job", status: "queued" }),
	};
	const manager = createManagerServer({
		root,
		token: "test-manager-session",
		jobs,
	});
	await new Promise((resolve, reject) => {
		manager.server.once("error", reject);
		manager.server.listen(0, "127.0.0.1", resolve);
	});
	const origin = `http://127.0.0.1:${manager.server.address().port}`;
	t.after(async () => {
		await new Promise((resolve, reject) =>
			manager.server.close((error) => (error ? reject(error) : resolve())),
		);
		await rm(root, { recursive: true, force: true });
	});
	return {
		...manager,
		root,
		origin,
		recorded,
		port: manager.server.address().port,
	};
}

async function request(manager, method, route, body, overrides = {}) {
	const headers = {
		host: `127.0.0.1:${manager.port}`,
		"x-manager-token": manager.token,
		origin: manager.origin,
		...(body === undefined ? {} : { "content-type": "application/json" }),
		...overrides,
	};
	for (const key of Object.keys(headers))
		if (headers[key] === undefined) delete headers[key];
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port: manager.port,
				path: route,
				method,
				headers,
				agent: false,
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("error", reject);
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					let json;
					try {
						json = JSON.parse(text);
					} catch {}
					resolve({ status: res.statusCode, headers: res.headers, text, json });
				});
			},
		);
		req.on("error", reject);
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
}

test("local UI injects this session token and sends defensive response headers", async (t) => {
	const manager = await fixture(t);
	const response = await request(manager, "GET", "/", undefined, {
		"x-manager-token": undefined,
		origin: undefined,
	});
	assert.equal(response.status, 200);
	assert.ok(response.text.includes(manager.token));
	assert.equal(response.text.includes("__MANAGER_TOKEN__"), false);
	assert.equal(response.headers["cache-control"], "no-store");
	assert.equal(response.headers["x-frame-options"], "DENY");
	assert.equal(response.headers["x-content-type-options"], "nosniff");
	assert.match(
		response.headers["content-security-policy"],
		/frame-ancestors 'none'/,
	);
	assert.equal((await request(manager, "GET", "/server.mjs")).status, 404);
});

test("API rejects missing or wrong token, forged Host and cross-site origins", async (t) => {
	const manager = await fixture(t);
	for (const headers of [
		{ "x-manager-token": undefined },
		{ "x-manager-token": "wrong" },
		{ host: "evil.test" },
		{ origin: "https://evil.test" },
		{ origin: "null" },
		{ "sec-fetch-site": "cross-site" },
	]) {
		const response = await request(
			manager,
			"GET",
			`/api/file?path=${examplePath}`,
			undefined,
			headers,
		);
		assert.equal(response.status, 403, JSON.stringify(headers));
		assert.equal(response.text.includes("Original body"), false);
	}
	for (const headers of [
		{ origin: undefined },
		{ origin: "null" },
		{ origin: "https://evil.test" },
	]) {
		assert.equal(
			(
				await request(
					manager,
					"POST",
					"/api/preview",
					{ markdown: "test" },
					headers,
				)
			).status,
			403,
		);
	}
});

test("file endpoints deny secrets and traversal without exposing file content", async (t) => {
	const manager = await fixture(t);
	for (const file of [
		".env",
		".git/config",
		"src/content/posts/../../../.env",
		"../.env",
		"C:/Windows/win.ini",
		"src\\content\\posts\\example.md",
		"src/config/.env",
	]) {
		const response = await request(
			manager,
			"GET",
			`/api/file?path=${encodeURIComponent(file)}`,
		);
		assert.ok(
			[400, 403, 404].includes(response.status),
			`${file}: ${response.status}`,
		);
		assert.equal(response.text.includes("PRIVATE_SENTINEL"), false);
		assert.equal(response.text.includes("PRIVATE_GIT_SENTINEL"), false);
	}
	const state = await request(manager, "GET", "/api/state");
	assert.equal(state.status, 200);
	assert.ok(state.json.files.some((file) => file.path === examplePath));
	assert.equal(
		state.json.files.some((file) => file.path.startsWith(".")),
		false,
	);
});

test("saving requires the current hash and preserves an external concurrent edit", async (t) => {
	const manager = await fixture(t);
	const original = await request(
		manager,
		"GET",
		`/api/file?path=${examplePath}`,
	);
	assert.equal(original.status, 200);
	const replacement = example.replace("Original body", "Saved by manager");
	const saved = await request(manager, "PUT", "/api/file", {
		path: examplePath,
		hash: original.json.hash,
		content: replacement,
	});
	assert.equal(saved.status, 200);
	assert.notEqual(saved.json.hash, original.json.hash);
	assert.equal(
		await readFile(path.join(manager.root, examplePath), "utf8"),
		replacement,
	);
	assert.deepEqual(manager.recorded, [[examplePath, saved.json.hash]]);
	const external = replacement.replace("Saved by manager", "Edited in VS Code");
	await writeFile(path.join(manager.root, examplePath), external);
	const conflict = await request(manager, "PUT", "/api/file", {
		path: examplePath,
		hash: saved.json.hash,
		content: replacement,
	});
	assert.equal(conflict.status, 409);
	assert.equal(
		await readFile(path.join(manager.root, examplePath), "utf8"),
		external,
	);
	assert.equal(manager.recorded.length, 1);
});

test("structured document saves preserve custom frontmatter and backups stay discoverable", async (t) => {
	const manager = await fixture(t);
	const original = await request(
		manager,
		"GET",
		`/api/document?path=${examplePath}`,
	);
	const saved = await request(manager, "PUT", "/api/document", {
		path: examplePath,
		hash: original.json.hash,
		frontmatter: { title: "Updated" },
		body: "New body",
	});
	assert.equal(saved.status, 200);
	const document = splitDocument(saved.json.content);
	assert.equal(document.frontmatter.custom, "retained");
	assert.equal(document.frontmatter.title, "Updated");
	const history = await request(manager, "GET", "/api/history");
	assert.equal(history.status, 200);
	assert.ok(Array.isArray(history.json.backups));
	assert.ok(history.json.backups.some((backup) => backup.path === examplePath));
});

test("new content templates use the existing collection fields and refuse overwrites", async (t) => {
	const manager = await fixture(t);
	for (const collection of [
		"posts",
		"moments",
		"thinking",
		"reports",
		"series",
		"spec",
	]) {
		const created = await request(manager, "POST", "/api/new", {
			collection,
			slug: `new-${collection}`,
			title: "测试内容",
		});
		assert.equal(created.status, 200, `${collection}: ${created.text}`);
		assert.equal(
			created.json.path,
			`src/content/${collection}/new-${collection}.md`,
		);
		const { frontmatter } = splitDocument(created.json.content);
		if (!["series", "spec"].includes(collection))
			assert.match(frontmatter.published, /^\d{4}-\d{2}-\d{2}$/);
		if (["posts", "moments", "reports"].includes(collection))
			assert.equal(frontmatter.draft, true);
		if (collection === "series") assert.equal(frontmatter.status, "ongoing");
	}
	assert.equal(
		(
			await request(manager, "POST", "/api/new", {
				collection: "posts",
				slug: "example",
				title: "Overwrite",
			})
		).status,
		409,
	);
	assert.equal(
		await readFile(path.join(manager.root, examplePath), "utf8"),
		example,
	);
});

test("preview escapes raw HTML and removes executable Markdown URL schemes", async (t) => {
	const manager = await fixture(t);
	const malicious =
		'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert%281%29)\n\n![image](javascript:alert%281%29)\n\n[normal](https://example.com/)';
	const response = await request(manager, "POST", "/api/preview", {
		markdown: malicious,
	});
	assert.equal(response.status, 200);
	const html = response.json.html;
	assert.doesNotMatch(html, /<script\b/i);
	assert.doesNotMatch(html, /<img\b[^>]*\bonerror\s*=/i);
	assert.doesNotMatch(html, /(?:href|src)\s*=\s*["']?javascript:/i);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /href="https:\/\/example\.com\/"/);
	assert.equal(
		(await request(manager, "POST", "/api/preview", { markdown: null })).status,
		413,
	);
});

test("busy jobs block mutations and invalid JSON media types are rejected", async (t) => {
	const manager = await fixture(t);
	const original = await request(
		manager,
		"GET",
		`/api/file?path=${examplePath}`,
	);
	manager.jobs.isRunning = () => true;
	const response = await request(manager, "PUT", "/api/file", {
		path: examplePath,
		hash: original.json.hash,
		content: example,
	});
	assert.equal(response.status, 409);
	assert.equal(manager.recorded.length, 0);
	assert.equal(
		(
			await request(
				manager,
				"POST",
				"/api/preview",
				{ markdown: "text" },
				{ "content-type": "text/plain" },
			)
		).status,
		415,
	);
});

test("opaque preview frames can load only the stylesheet and token-protected media", async (t) => {
	const manager = await fixture(t);
	const opaque = { origin: "null", "sec-fetch-site": "cross-site" };
	assert.equal(
		(await request(manager, "GET", "/style.css", undefined, opaque)).status,
		200,
	);
	assert.equal(
		(
			await request(
				manager,
				"GET",
				`/api/file?path=${examplePath}`,
				undefined,
				opaque,
			)
		).status,
		403,
	);
	assert.equal(
		(await request(manager, "GET", "/api/state", undefined, opaque)).status,
		403,
	);
	assert.equal(
		(await request(manager, "GET", "/", undefined, opaque)).status,
		403,
	);
	assert.equal(
		(
			await request(
				manager,
				"GET",
				"/api/media?path=public/images/x.png",
				undefined,
				{ ...opaque, "x-manager-token": undefined },
			)
		).status,
		403,
	);
	assert.equal(
		(
			await request(
				manager,
				"POST",
				"/api/preview",
				{ markdown: "text" },
				opaque,
			)
		).status,
		403,
	);
});
