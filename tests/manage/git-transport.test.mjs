import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	pushCommit,
	readRemoteCommit,
} from "../../scripts/manage/git-transport.mjs";

const TOKEN = "fixture-secret-never-log";
const OTHER = "f".repeat(40);
const network = () =>
	Object.assign(new Error("Recv failure: Connection was reset"), {
		stderr: "TLS connection reset",
	});
const objectSha = (kind, bytes) =>
	createHash("sha1")
		.update(Buffer.from(`${kind} ${bytes.length}\0`))
		.update(bytes)
		.digest("hex");

async function fixture(t, options = {}) {
	const root = await mkdtemp(path.join(tmpdir(), "blog-transport-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const env = {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_DATE: "2026-11-14T12:00:00+08:00",
		GIT_COMMITTER_DATE: "2026-11-14T12:00:00+08:00",
	};
	const local = (args) =>
		execFileSync("git", args, {
			cwd: root,
			windowsHide: true,
			encoding: null,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});
	await mkdir(path.join(root, "src/content/posts"), { recursive: true });
	await mkdir(path.join(root, "public/old/deep"), { recursive: true });
	await writeFile(path.join(root, "src/content/posts/post.md"), "# Original\n");
	await writeFile(
		path.join(root, "public/old/deep/deleted.webp"),
		Buffer.from([0, 255, 4, 5]),
	);
	local(["init", "-b", "main"]);
	local(["config", "user.name", "Transport Fixture"]);
	local(["config", "user.email", "transport@example.invalid"]);
	local(["add", "--", "src", "public"]);
	local(["commit", "-m", "test: base"]);
	const parent = local(["rev-parse", "HEAD"]).toString().trim();
	const parentTree = local(["rev-parse", "HEAD^{tree}"]).toString().trim();
	await writeFile(path.join(root, "src/content/posts/post.md"), "# Changed\n");
	await writeFile(path.join(root, "src/content/posts/新文章.md"), "# 中文\n");
	await mkdir(path.join(root, "public/images"), { recursive: true });
	const image = Buffer.from([255, 216, 255, 0, 128, 12, 255, 217]);
	await writeFile(path.join(root, "public/images/new.webp"), image);
	await unlink(path.join(root, "public/old/deep/deleted.webp"));
	local(["add", "--", "src", "public"]);
	local(["commit", "-m", "content: fixture publish"]);
	const commit = local(["rev-parse", "HEAD"]).toString().trim();
	const tree = local(["rev-parse", "HEAD^{tree}"]).toString().trim();
	local([
		"remote",
		"add",
		"origin",
		options.origin || "https://github.com/fixture-owner/blog.git",
	]);
	const calls = [];
	const logs = [];
	const sleeps = [];
	let pushes = 0;
	const runGit = async (args, opts) => {
		calls.push({ args, opts });
		if (args.includes("push")) {
			pushes++;
			if (options.nativeSuccess || pushes === options.succeedOnPush)
				return Buffer.from("= refs/heads/main [up to date]\n");
			throw options.nativeError ? options.nativeError() : network();
		}
		if (args.includes("credential")) {
			if (options.noCredential) throw new Error(TOKEN);
			return Buffer.from(
				`protocol=https\nhost=github.com\nusername=fixture\npassword=${TOKEN}\n`,
			);
		}
		if (args[0] === "ls-remote") {
			if (options.remoteReadSuccess)
				return Buffer.from(`${parent}\trefs/heads/main\n`);
			throw options.nativeError ? options.nativeError() : network();
		}
		assert.ok(
			[
				"rev-parse",
				"symbolic-ref",
				"rev-list",
				"remote",
				"cat-file",
				"ls-tree",
				"diff-tree",
			].includes(args[0]),
			`Unexpected real Git command: ${args[0]}`,
		);
		return local(args);
	};
	const apiCalls = [];
	let remote = options.remote || parent;
	let transient = false;
	const fetchImpl = async (input, init) => {
		const url = new URL(input);
		assert.equal(url.origin, "https://api.github.com");
		assert.equal(init.redirect, "error");
		assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
		const route =
			url.pathname.replace("/repos/fixture-owner/blog", "") + url.search;
		const body = init.body ? JSON.parse(init.body) : null;
		apiCalls.push({ method: init.method, route, body });
		const response = (value, status = 200, headers = {}) =>
			new Response(JSON.stringify(value), {
				status,
				headers: { "Content-Type": "application/json", ...headers },
			});
		if (options.apiAuth) return response({}, 401);
		if (options.transient && !transient) {
			transient = true;
			return response({}, options.transient, { "Retry-After": "999" });
		}
		if (route === "/git/ref/heads/main")
			return response({
				ref: "refs/heads/main",
				object: { type: "commit", sha: remote },
			});
		if (route === `/git/commits/${parent}`)
			return response({ sha: parent, tree: { sha: parentTree } });
		if (route === `/git/commits/${commit}`)
			return response({
				sha: commit,
				tree: { sha: tree },
				parents: [{ sha: parent }],
			});
		if (route.startsWith(`/compare/${commit}...`))
			return response({
				status: options.descendant ? "ahead" : "diverged",
				merge_base_commit: { sha: options.descendant ? commit : parent },
			});
		if (route === "/git/blobs")
			return response({
				sha: options.badBlob
					? OTHER
					: objectSha("blob", Buffer.from(body.content, "base64")),
			});
		if (route === "/git/trees")
			return response({ sha: options.badTree ? OTHER : tree });
		if (route === "/git/commits") {
			if (options.advanceBeforePatch) remote = OTHER;
			return response({ sha: options.badCommit ? OTHER : commit });
		}
		if (route === "/git/refs/heads/main") {
			assert.equal(body.force, false);
			assert.equal(body.sha, commit);
			if (!options.patchNotAccepted) remote = commit;
			if (options.lostPatchResponse || options.patchNotAccepted)
				throw new TypeError(TOKEN);
			return response({ object: { sha: commit } });
		}
		throw new Error(`Unexpected mock API path: ${route}`);
	};
	return {
		root,
		local,
		commit,
		parent,
		parentTree,
		tree,
		image,
		calls,
		apiCalls,
		logs,
		sleeps,
		options: {
			root,
			commit,
			parent,
			runGit,
			fetchImpl,
			log: (line) => logs.push(line),
			sleep: async (ms) => {
				sleeps.push(ms);
			},
		},
		remote: () => remote,
	};
}

test("native push pins the exact commit, uses HTTP/1.1 and avoids API credentials", async (t) => {
	const f = await fixture(t, { nativeSuccess: true });
	const value = await pushCommit(f.options);
	assert.equal(value.transport, "git");
	assert.equal(value.observedRemoteHead, f.commit);
	const push = f.calls.find(({ args }) => args.includes("push"));
	assert.ok(push.args.includes("http.version=HTTP/1.1"));
	assert.ok(push.args.includes("--no-follow-tags"));
	assert.ok(push.args.includes("--recurse-submodules=no"));
	assert.equal(push.args.at(-1), `${f.commit}:refs/heads/main`);
	assert.equal(push.args.at(-2), "https://github.com/fixture-owner/blog.git");
	assert.equal(push.args.at(-3), "--");
	assert.equal(f.apiCalls.length, 0);
	assert.ok(!f.calls.some(({ args }) => args.includes("credential")));
});

test("transient Git failure gets one retry before changing transport", async (t) => {
	const f = await fixture(t, { succeedOnPush: 2 });
	assert.equal((await pushCommit(f.options)).transport, "git");
	assert.equal(f.calls.filter(({ args }) => args.includes("push")).length, 2);
	assert.deepEqual(f.sleeps, [750]);
	assert.equal(f.apiCalls.length, 0);
});

for (const [name, message, code] of [
	["authentication", "Authentication failed", "GIT_AUTH"],
	["non-fast-forward", "rejected non-fast-forward", "GIT_DIVERGED"],
]) {
	test(`${name} is not retried or sent to API fallback`, async (t) => {
		const f = await fixture(t, { nativeError: () => new Error(message) });
		await assert.rejects(pushCommit(f.options), { code });
		assert.equal(f.calls.filter(({ args }) => args.includes("push")).length, 1);
		assert.equal(f.apiCalls.length, 0);
	});
}

test("API fallback preserves exact commit, binary uploads, deletion, and +08:00 dates", async (t) => {
	const f = await fixture(t);
	const value = await pushCommit(f.options);
	assert.equal(value.transport, "github-api");
	assert.equal(value.observedRemoteHead, f.commit);
	assert.equal(f.remote(), f.commit);
	const tree = f.apiCalls.find((x) => x.route === "/git/trees");
	assert.equal(tree.body.base_tree, f.parentTree);
	assert.equal(
		tree.body.tree.find((x) => x.path === "public/old/deep/deleted.webp").sha,
		null,
	);
	assert.ok(
		f.apiCalls.some(
			(x) =>
				x.route === "/git/blobs" &&
				Buffer.from(x.body.content, "base64").equals(f.image),
		),
	);
	const commit = f.apiCalls.find(
		(x) => x.method === "POST" && x.route === "/git/commits",
	);
	assert.match(commit.body.author.date, /\+08:00$/);
	assert.match(commit.body.committer.date, /\+08:00$/);
	assert.equal(commit.body.message, "content: fixture publish\n");
	assert.ok(!JSON.stringify(f.logs).includes(TOKEN));
	assert.ok(
		!f.calls.some(({ args }) =>
			["update-ref", "reset", "add", "commit", "checkout"].includes(args[0]),
		),
	);
});

for (const field of ["badBlob", "badTree", "badCommit"]) {
	test(`${field} SHA mismatch stops before updating main`, async (t) => {
		const f = await fixture(t, { [field]: true });
		await assert.rejects(pushCommit(f.options), { code: "GITHUB_MISMATCH" });
		assert.equal(f.remote(), f.parent);
		assert.ok(!f.apiCalls.some((x) => x.method === "PATCH"));
	});
}

test("API can confirm an already accepted commit without uploading or patching", async (t) => {
	const f = await fixture(t);
	const original = f.options.fetchImpl;
	f.options.fetchImpl = async (url, init) =>
		url.endsWith("/git/ref/heads/main")
			? new Response(
					JSON.stringify({
						ref: "refs/heads/main",
						object: { type: "commit", sha: f.commit },
					}),
				)
			: original(url, init);
	assert.equal((await pushCommit(f.options)).alreadyPublished, true);
	assert.ok(!f.apiCalls.some((x) => x.method !== "GET"));
});

test("a proven descendant confirms inclusion without moving the remote backwards", async (t) => {
	const f = await fixture(t, { remote: OTHER, descendant: true });
	const value = await pushCommit(f.options);
	assert.equal(value.observedRemoteHead, OTHER);
	assert.equal(value.alreadyPublished, true);
	assert.ok(!f.apiCalls.some((x) => x.method !== "GET"));
});

for (const timing of ["initial", "before-patch"]) {
	test(`diverged remote ${timing} is never overwritten`, async (t) => {
		const f = await fixture(
			t,
			timing === "initial" ? { remote: OTHER } : { advanceBeforePatch: true },
		);
		await assert.rejects(pushCommit(f.options), { code: "REMOTE_CHANGED" });
		assert.ok(!f.apiCalls.some((x) => x.method === "PATCH"));
	});
}

test("lost ref-update response is reconciled by GET with no second PATCH", async (t) => {
	const f = await fixture(t, { lostPatchResponse: true });
	const value = await pushCommit(f.options);
	assert.equal(value.observedRemoteHead, f.commit);
	assert.equal(f.apiCalls.filter((x) => x.method === "PATCH").length, 1);
	assert.ok(!JSON.stringify(f.logs).includes(TOKEN));
});

test("unaccepted ref update remains retryable and never logs sensitive errors", async (t) => {
	const f = await fixture(t, { patchNotAccepted: true });
	await assert.rejects(
		pushCommit(f.options),
		(error) =>
			error.code === "GITHUB_NETWORK" &&
			error.retryable &&
			!String(error).includes(TOKEN) &&
			error.cause.code === "GIT_NETWORK",
	);
	assert.equal(f.apiCalls.filter((x) => x.method === "PATCH").length, 1);
	assert.equal(f.remote(), f.parent);
});

for (const status of [429, 503]) {
	test(`API ${status} receives one bounded retry`, async (t) => {
		const f = await fixture(t, { transient: status });
		await pushCommit(f.options);
		assert.ok(f.sleeps.includes(2000));
		assert.ok(f.sleeps.every((ms) => ms <= 2000));
	});
}

test("API authentication failure does not retry or expose credentials", async (t) => {
	const f = await fixture(t, { apiAuth: true });
	await assert.rejects(
		pushCommit(f.options),
		(error) => error.code === "GITHUB_AUTH" && !String(error).includes(TOKEN),
	);
	assert.equal(f.apiCalls.length, 1);
});

test("missing credential gets a useful safe error without network calls", async (t) => {
	const f = await fixture(t, { noCredential: true });
	await assert.rejects(
		pushCommit(f.options),
		(error) => error.code === "GITHUB_AUTH" && !String(error).includes(TOKEN),
	);
	assert.equal(f.apiCalls.length, 0);
});

for (const origin of [
	"https://github.com.evil.invalid/fixture-owner/blog.git",
	`https://${TOKEN}@github.com/fixture-owner/blog.git`,
	"https://github.com:8443/fixture-owner/blog.git",
]) {
	test(`unsafe API origin is never given a credential: ${origin.replace(TOKEN, "redacted")}`, async (t) => {
		const f = await fixture(t, { origin });
		await assert.rejects(pushCommit(f.options), { code: "GIT_NETWORK" });
		assert.equal(f.apiCalls.length, 0);
		assert.ok(!f.calls.some(({ args }) => args.includes("credential")));
	});
}

test("readRemoteCommit uses ls-remote without mutating local references", async (t) => {
	const f = await fixture(t, { remoteReadSuccess: true });
	assert.equal(await readRemoteCommit(f.options), f.parent);
	assert.equal(f.apiCalls.length, 0);
	assert.equal(f.calls.filter(({ args }) => args[0] === "ls-remote").length, 1);
	assert.equal(
		f.calls.find(({ args }) => args[0] === "ls-remote").args.at(-2),
		"https://github.com/fixture-owner/blog.git",
	);
});

test("readRemoteCommit falls back to API only for network failures", async (t) => {
	const f = await fixture(t);
	assert.equal(await readRemoteCommit(f.options), f.parent);
	assert.equal(f.apiCalls.length, 1);
	assert.equal(f.apiCalls[0].method, "GET");
	assert.ok(
		!f.calls.some(
			({ args }) => args.includes("push") || args.includes("update-ref"),
		),
	);
});

test("a changed HEAD stops before pushing or obtaining any credential", async (t) => {
	const f = await fixture(t);
	const original = f.options.runGit;
	f.options.runGit = async (args, options) =>
		args[0] === "rev-parse" && args[1] === "HEAD"
			? Buffer.from(`${OTHER}\n`)
			: original(args, options);
	await assert.rejects(pushCommit(f.options), { code: "HEAD_CHANGED" });
	assert.equal(f.apiCalls.length, 0);
	assert.ok(
		!f.calls.some(
			({ args }) => args.includes("push") || args.includes("credential"),
		),
	);
});

test("remote-read authentication failures do not silently switch credentials", async (t) => {
	const f = await fixture(t, {
		nativeError: () => new Error("Authentication failed"),
	});
	await assert.rejects(readRemoteCommit(f.options), { code: "GIT_AUTH" });
	assert.equal(f.apiCalls.length, 0);
	assert.equal(f.calls.filter(({ args }) => args[0] === "ls-remote").length, 1);
});

test("a pending origin mismatch stops before any native push or API request", async (t) => {
	const f = await fixture(t);
	f.options.expectedRemote = `https://${TOKEN}@github.com/other-owner/blog.git`;
	await assert.rejects(
		pushCommit(f.options),
		(error) =>
			error.code === "REMOTE_CHANGED" && !String(error).includes(TOKEN),
	);
	assert.ok(
		!f.calls.some(
			({ args }) => args.includes("push") || args.includes("credential"),
		),
	);
	assert.equal(f.apiCalls.length, 0);
});

test("changing origin before a native retry never writes to the new repository", async (t) => {
	const f = await fixture(t);
	let changed = false;
	const original = f.options.runGit;
	f.options.runGit = async (args, opts) => {
		if (args.includes("push")) {
			assert.equal(args.at(-2), "https://github.com/fixture-owner/blog.git");
			changed = true;
		}
		if (changed && args[0] === "remote")
			return Buffer.from(`https://${TOKEN}@github.com/other-owner/blog.git\n`);
		return original(args, opts);
	};
	await assert.rejects(
		pushCommit(f.options),
		(error) =>
			error.code === "REMOTE_CHANGED" && !String(error).includes(TOKEN),
	);
	assert.equal(f.calls.filter(({ args }) => args.includes("push")).length, 1);
	assert.equal(f.apiCalls.length, 0);
});

test("native push uses a captured URL even if origin changes just before Git executes", async (t) => {
	const f = await fixture(t);
	const original = f.options.runGit;
	let changed = false;
	f.options.runGit = async (args, opts) => {
		if (args.includes("push")) {
			changed = true;
			assert.equal(args.at(-2), "https://github.com/fixture-owner/blog.git");
			assert.ok(!args.includes("origin"));
			return Buffer.from("pushed pinned destination\n");
		}
		if (changed && args[0] === "remote")
			return Buffer.from("https://github.com/other-owner/blog.git\n");
		return original(args, opts);
	};
	await assert.rejects(pushCommit(f.options), { code: "REMOTE_CHANGED" });
	assert.equal(f.apiCalls.length, 0);
});

test("an origin change between API requests stops further object writes and ref updates", async (t) => {
	const f = await fixture(t);
	let changed = false;
	const originalGit = f.options.runGit;
	const originalFetch = f.options.fetchImpl;
	f.options.runGit = async (args, opts) =>
		changed && args[0] === "remote"
			? Buffer.from("https://github.com/other-owner/blog.git\n")
			: originalGit(args, opts);
	f.options.fetchImpl = async (url, init) => {
		const response = await originalFetch(url, init);
		if (init.method === "GET") changed = true;
		return response;
	};
	await assert.rejects(pushCommit(f.options), { code: "REMOTE_CHANGED" });
	assert.ok(!f.apiCalls.some(({ method }) => method !== "GET"));
});

test("an origin change during an object upload prevents all following API mutations", async (t) => {
	const f = await fixture(t);
	let changed = false;
	const originalGit = f.options.runGit;
	const originalFetch = f.options.fetchImpl;
	f.options.runGit = async (args, opts) =>
		changed && args[0] === "remote"
			? Buffer.from("https://github.com/other-owner/blog.git\n")
			: originalGit(args, opts);
	f.options.fetchImpl = async (url, init) => {
		const response = await originalFetch(url, init);
		if (init.method === "POST") changed = true;
		return response;
	};
	await assert.rejects(pushCommit(f.options), { code: "REMOTE_CHANGED" });
	assert.equal(f.apiCalls.filter(({ method }) => method === "POST").length, 1);
	assert.ok(!f.apiCalls.some(({ method }) => method === "PATCH"));
});

test("readRemoteCommit rejects an origin change after reading the captured target", async (t) => {
	const f = await fixture(t, { remoteReadSuccess: true });
	let changed = false;
	const original = f.options.runGit;
	f.options.runGit = async (args, opts) => {
		if (args[0] === "ls-remote") {
			assert.equal(args.at(-2), "https://github.com/fixture-owner/blog.git");
			changed = true;
		}
		if (changed && args[0] === "remote")
			return Buffer.from("https://github.com/other-owner/blog.git\n");
		return original(args, opts);
	};
	await assert.rejects(readRemoteCommit(f.options), { code: "REMOTE_CHANGED" });
	assert.equal(f.apiCalls.length, 0);
});

test("readRemoteCommit never falls back to a newly changed origin", async (t) => {
	const f = await fixture(t);
	let changed = false;
	const original = f.options.runGit;
	f.options.runGit = async (args, opts) => {
		if (args[0] === "ls-remote") changed = true;
		if (changed && args[0] === "remote")
			return Buffer.from("https://github.com/other-owner/blog.git\n");
		return original(args, opts);
	};
	await assert.rejects(readRemoteCommit(f.options), { code: "REMOTE_CHANGED" });
	assert.equal(f.apiCalls.length, 0);
});

test("the default process runner can push to an isolated local bare remote", async (t) => {
	const f = await fixture(t);
	const remote = path.join(f.root, "remote.git");
	const wrongRemote = path.join(f.root, "wrong-remote.git");
	f.local(["init", "--bare", remote]);
	f.local(["init", "--bare", wrongRemote]);
	f.local(["remote", "set-url", "origin", remote]);
	f.local(["push", "origin", `${f.parent}:refs/heads/main`]);
	f.local(["config", "remote.origin.pushurl", wrongRemote]);
	const head = f.local(["rev-parse", "HEAD"]);
	const index = f.local(["ls-files", "--stage"]);
	const value = await pushCommit({
		root: f.root,
		commit: f.commit,
		parent: f.parent,
		expectedRemote: remote,
	});
	assert.equal(value.transport, "git");
	assert.equal(await readRemoteCommit({ root: f.root }), f.commit);
	assert.ok(f.local(["rev-parse", "HEAD"]).equals(head));
	assert.ok(f.local(["ls-files", "--stage"]).equals(index));
	assert.throws(() =>
		f.local([
			"--git-dir",
			wrongRemote,
			"rev-parse",
			"--verify",
			"refs/heads/main",
		]),
	);
});
