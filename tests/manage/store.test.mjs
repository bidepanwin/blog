import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { createStore } from "../../scripts/manage/store.mjs";

const roots = [];
const POST = "src/content/posts/hello.md";
const ORIGINAL = "---\ntitle: Hello\n---\n\nOriginal content.\n";
const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9mQAAAAASUVORK5CYII=";

async function put(root, path, value) {
	await fs.mkdir(dirname(join(root, path)), { recursive: true });
	await fs.writeFile(join(root, path), value);
}

async function fixture() {
	const root = await fs.mkdtemp(join(tmpdir(), "shirone-manager-store-"));
	roots.push(root);
	await put(root, POST, ORIGINAL);
	await put(
		root,
		"src/config/siteConfig.ts",
		"export const site = { title: 'Hello' };\n",
	);
	await put(root, "src/data/friends.json", "[]\n");
	await put(
		root,
		"src/styles/personal-blog.css",
		":root { color: inherit; }\n",
	);
	await put(root, "src/i18n/languages/zh_CN.ts", "export const words = {};\n");
	await put(root, "public/albums/one/info.json", '{"title":"One"}\n');
	await put(root, "public/images/test.png", Buffer.from(PNG, "base64"));
	await put(
		root,
		"src/assets/images/封面 test.png",
		Buffer.from(PNG, "base64"),
	);
	await put(root, ".env", "TOP_SECRET=not-public\n");
	await put(root, "src/config/index.ts", "export {};\n");
	await put(root, "src/data/reports/old.html", "<p>Not editable</p>");
	await put(root, "public/admin/hidden.json", "{}");
	await put(root, "public/node_modules/hidden.json", "{}");
	await put(root, "public/script.js", "alert('not editable');");
	return { root, store: createStore(root) };
}

function status(expected) {
	return (error) => {
		assert.equal(error.status, expected, error.message);
		return true;
	};
}

afterEach(async () => {
	for (const root of roots.splice(0))
		await fs.rm(root, { recursive: true, force: true });
});

test("catalog exposes only editable source files and read returns UTF-8 with a SHA-256 version", async () => {
	const { store } = await fixture();
	const catalog = await store.catalog();
	assert.deepEqual(
		catalog.files.map((file) => file.path).sort(),
		[
			POST,
			"src/config/siteConfig.ts",
			"src/data/friends.json",
			"src/styles/personal-blog.css",
			"src/i18n/languages/zh_CN.ts",
			"public/albums/one/info.json",
		].sort(),
	);
	assert.equal(catalog.files.find((file) => file.path === POST).group, "posts");
	assert.ok(
		catalog.files.every(
			(file) => file.size > 0 && Number.isFinite(Date.parse(file.modifiedAt)),
		),
	);
	const file = await store.read(POST);
	assert.equal(file.content, ORIGINAL);
	assert.equal(file.hash, createHash("sha256").update(ORIGINAL).digest("hex"));
});

test("all APIs reject traversal, absolute paths, Windows alternate streams, hidden and executable paths", async () => {
	const { store } = await fixture();
	for (const path of [
		"../.env",
		".env",
		"/src/content/a.md",
		"C:/src/content/a.md",
		"src\\content\\a.md",
		"src/content/../config/a.ts",
		"src/content//a.md",
		"src/content/a.md:secret",
		"src/content/NUL.md",
		"src/content/name. /a.md",
		"src/config/index.ts",
		"public/admin/x.json",
		"public/a.html",
		"scripts/x.mjs",
		"src/data/x.html",
		"src/styles/main.css",
		"src/i18n/languages/nested/en.ts",
	]) {
		await assert.rejects(store.read(path), status(400), path);
		await assert.rejects(
			store.write({ path, content: "test", create: true }),
			status(400),
			path,
		);
		await assert.rejects(
			store.remove({ path, hash: "a".repeat(64) }),
			status(400),
			path,
		);
	}
	await assert.rejects(store.read("src/content/posts/missing.md"), status(404));
	await assert.rejects(store.write(null), status(400));
	await assert.rejects(store.remove([]), status(400));
	await assert.rejects(store.upload("image"), status(400));
});

test("writes require the current hash, back up exact bytes, and reject concurrent stale versions", async () => {
	const { root, store } = await fixture();
	const before = await store.read(POST);
	await assert.rejects(
		store.write({ path: POST, content: "changed" }),
		status(409),
	);
	const result = await store.write({ ...before, content: "Changed once.\n" });
	assert.equal((await store.read(POST)).content, "Changed once.\n");
	assert.notEqual(result.hash, before.hash);
	assert.equal(
		await fs.readFile(
			join(root, ".local-manager/backups", result.backupId, "content"),
			"utf8",
		),
		ORIGINAL,
	);
	await assert.rejects(
		store.write({ ...before, content: "stale" }),
		status(409),
	);
	const attempts = await Promise.allSettled([
		store.write({ path: POST, hash: result.hash, content: "Concurrent A" }),
		store.write({ path: POST, hash: result.hash, content: "Concurrent B" }),
	]);
	assert.equal(
		attempts.filter((item) => item.status === "fulfilled").length,
		1,
	);
	assert.equal(
		attempts.find((item) => item.status === "rejected").reason.status,
		409,
	);
	assert.equal((await store.history()).backups.length, 2);
	assert.ok(
		!(await fs.readdir(dirname(join(root, POST)))).some((name) =>
			name.endsWith(".tmp"),
		),
	);
});

test("explicit creation makes nested directories, never replaces an existing file, and can be undone", async () => {
	const { store } = await fixture();
	const path = "src/content/posts/new-folder/新的笔记.md";
	await assert.rejects(store.write({ path, content: "# New" }), status(409));
	const created = await store.write({ path, content: "# New\n", create: true });
	assert.equal((await store.read(path)).content, "# New\n");
	await assert.rejects(
		store.write({ path, content: "overwrite", create: true }),
		status(409),
	);
	const restored = await store.restore(created.backupId);
	assert.equal(restored.removed, true);
	await assert.rejects(store.read(path), status(404));
	await store.restore(restored.backupId);
	assert.equal((await store.read(path)).content, "# New\n");
});

test("deletion and restoration retain both prior versions in private backups", async () => {
	const { root, store } = await fixture();
	const original = await store.read(POST);
	const deleted = await store.remove(original);
	await assert.rejects(store.read(POST), status(404));
	const restored = await store.restore(deleted.backupId);
	assert.equal(restored.content, ORIGINAL);
	assert.equal(restored.hash, original.hash);
	const history = await store.history();
	assert.equal(history.backups.length, 2);
	assert.ok(history.backups.every((item) => !item.path.startsWith("public/")));
	assert.ok(
		!(await store.catalog()).files.some((file) =>
			file.path.startsWith(".local-manager"),
		),
	);
	await assert.rejects(store.restore("../metadata.json"), status(400));
	const manifest = join(
		root,
		".local-manager/backups",
		deleted.backupId,
		"metadata.json",
	);
	const metadata = JSON.parse(await fs.readFile(manifest, "utf8"));
	metadata.path = ".env";
	await fs.writeFile(manifest, JSON.stringify(metadata));
	await assert.rejects(store.restore(deleted.backupId), status(400));
});

test("syntax validation never executes TypeScript and rejects broken JSON and YAML before writing", async () => {
	const { store } = await fixture();
	const config = await store.read("src/config/siteConfig.ts");
	const marker = "__shirone_store_should_not_execute";
	await store.write({
		...config,
		content: `globalThis.${marker} = true; export const site = {};\n`,
	});
	assert.equal(globalThis[marker], undefined);
	const current = await store.read(config.path);
	await assert.rejects(
		store.write({ ...current, content: "export const broken = { ;" }),
		status(400),
	);
	const json = await store.read("src/data/friends.json");
	await assert.rejects(
		store.write({ ...json, content: '{"missing":}' }),
		status(400),
	);
	const post = await store.read(POST);
	for (const content of [
		"---\ntitle: [unfinished\n---\nBody",
		"---\ntitle: No ending",
		"---\ntitle: one\ntitle: two\n---\nBody",
		"binary\0text",
		"bad\uD800text",
	]) {
		await assert.rejects(store.write({ ...post, content }), status(400));
	}
	assert.equal((await store.read(POST)).content, ORIGINAL);
	assert.equal((await store.history()).backups.length, 1);
});

test("text size and invalid UTF-8 are rejected without truncating the file", async () => {
	const { root, store } = await fixture();
	const before = await store.read(POST);
	await assert.rejects(
		store.write({ ...before, content: "中".repeat(400000) }),
		status(413),
	);
	await put(root, "src/content/posts/invalid.md", Buffer.from([0xff, 0xfe]));
	await assert.rejects(store.read("src/content/posts/invalid.md"), status(400));
	await put(
		root,
		"src/content/posts/large.md",
		Buffer.alloc(1024 * 1024 + 1, 65),
	);
	await assert.rejects(store.read("src/content/posts/large.md"), status(413));
	assert.equal((await store.read(POST)).content, ORIGINAL);
});

test("raster uploads check signatures, use unique names, and never expose text editing for images", async () => {
	const { root, store } = await fixture();
	const first = await store.upload({ name: "My image.png", data: PNG });
	const second = await store.upload({ name: "My image.png", data: PNG });
	assert.notEqual(first.path, second.path);
	assert.match(first.path, /^public\/images\/uploads\/[a-f0-9-]+\.png$/u);
	assert.equal(first.reference, `/${first.path.slice("public/".length)}`);
	assert.deepEqual(
		await fs.readFile(join(root, first.path)),
		Buffer.from(PNG, "base64"),
	);
	const media = await store.listMedia();
	assert.equal(media.files.length, 4);
	assert.ok(
		media.files.some(
			(file) =>
				file.path === "src/assets/images/封面 test.png" &&
				file.reference === "assets/images/封面 test.png",
		),
	);
	await assert.rejects(
		store.read("src/assets/images/封面 test.png"),
		status(400),
	);
	assert.ok(
		media.files.some((file) => file.path === first.path && file.size > 0),
	);
	await assert.rejects(store.read(first.path), status(400));
	for (const input of [
		{ name: "x.svg", data: Buffer.from("<svg/>").toString("base64") },
		{
			name: "x.png",
			data: Buffer.from("<script>alert(1)</script>").toString("base64"),
		},
		{ name: "x.jpg", data: PNG },
		{ name: "../x.png", data: PNG },
		{ name: "x.png", data: "not base64!" },
	])
		await assert.rejects(store.upload(input), status(400));
	await assert.rejects(
		store.upload({
			name: "huge.png",
			data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
		}),
		status(413),
	);
});

test("directory symlinks and junctions cannot escape through reads, writes, catalogs or uploads", async () => {
	const { root, store } = await fixture();
	const external = await fs.mkdtemp(join(tmpdir(), "shirone-manager-outside-"));
	roots.push(external);
	await fs.writeFile(join(external, "secret.md"), "Do not expose me");
	await fs.symlink(
		external,
		join(root, "src/content/escape"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(store.read("src/content/escape/secret.md"), status(400));
	await assert.rejects(
		store.write({
			path: "src/content/escape/new.md",
			content: "bad",
			create: true,
		}),
		status(400),
	);
	assert.ok(
		!(await store.catalog()).files.some((file) => file.path.includes("escape")),
	);
	await fs.symlink(
		external,
		join(root, "public/images/uploads"),
		process.platform === "win32" ? "junction" : "dir",
	);
	await assert.rejects(store.upload({ name: "x.png", data: PNG }), status(400));
	assert.deepEqual(await fs.readdir(external), ["secret.md"]);
});
