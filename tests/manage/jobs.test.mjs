import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { createJobs } from "../../scripts/manage/jobs.mjs";
import { createStore } from "../../scripts/manage/store.mjs";

const run = promisify(execFile);
const POST = "src/content/posts/test.md";
async function fixture(t, jobOptions = {}) {
	const parent = await mkdtemp(path.join(tmpdir(), "blog-manager-jobs-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const root = path.join(parent, "work");
	await mkdir(path.join(root, "src/content/posts"), { recursive: true });
	await writeFile(path.join(root, POST), "# Original\n");
	await writeFile(
		path.join(root, ".gitignore"),
		".local-manager/\npnpm-stub.cjs\n",
	);
	const git = async (...args) =>
		(await run("git", args, { cwd: root, windowsHide: true })).stdout;
	await git("init", "-b", "main");
	await git("config", "user.name", "Manager Test");
	await git("config", "user.email", "manager-test@example.invalid");
	await git("add", "--", POST, ".gitignore");
	await git("commit", "-m", "test: initial fixture");
	const remote = path.join(parent, "remote.git");
	await run("git", ["init", "--bare", remote], { windowsHide: true });
	await git("remote", "add", "origin", remote);
	await git("push", "-u", "origin", "main");
	const pnpmPath = path.join(root, "pnpm-stub.cjs");
	await writeFile(
		pnpmPath,
		"console.log('fixture pnpm', process.argv.slice(2).join(' '));\n",
	);
	const store = createStore(root);
	const jobs = createJobs(root, { pnpmPath, ...jobOptions });
	return { root, git, store, jobs, pnpmPath, remote };
}
async function finished(jobs, id) {
	for (let i = 0; i < 600; i++) {
		const job = jobs.get(id);
		if (job.status !== "running") return job;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Fixture job did not finish");
}

test("publish validates and pushes only saved paths to a local fixture remote", async (t) => {
	const { root, git, store, jobs } = await fixture(t);
	const before = await store.read(POST);
	const saved = await store.write({ ...before, content: "# Saved by owner\n" });
	await jobs.record(saved.path, saved.hash);
	await writeFile(path.join(root, "unrelated.txt"), "Do not publish me\n");
	const task = jobs.start("publish", {
		message: "content(blog): test isolated publish",
		store,
	});
	assert.throws(() => jobs.start("validate"), /运行/);
	const job = await finished(jobs, task.id);
	assert.equal(job.status, "success", job.message);
	assert.ok(job.log.some((line) => line.includes("fixture pnpm astro check")));
	assert.ok(job.log.some((line) => line.includes("fixture pnpm build")));
	assert.equal(
		(await git("show", "--pretty=", "--name-only", "HEAD")).trim(),
		POST,
	);
	assert.equal(
		(await git("rev-parse", "HEAD")).trim(),
		(await git("rev-parse", "origin/main")).trim(),
	);
	assert.equal(
		await readFile(path.join(root, "unrelated.txt"), "utf8"),
		"Do not publish me\n",
	);
	assert.match(await git("status", "--porcelain"), /unrelated\.txt/);
});

test("publish refuses staged changes and preserves the existing index", async (t) => {
	const { root, git, store, jobs } = await fixture(t);
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Saved\n",
	});
	await jobs.record(saved.path, saved.hash);
	await writeFile(path.join(root, "other.txt"), "staged\n");
	await git("add", "--", "other.txt");
	const head = await git("rev-parse", "HEAD");
	const job = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(job.status, "failed");
	assert.match(job.message, /暂存区/);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal(
		(await git("diff", "--cached", "--name-only")).trim(),
		"other.txt",
	);
});

test("publish refuses an externally changed managed file before any commit", async (t) => {
	const { root, git, store, jobs } = await fixture(t);
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Saved\n",
	});
	await jobs.record(saved.path, saved.hash);
	await writeFile(path.join(root, POST), "# Changed outside studio\n");
	const head = await git("rev-parse", "HEAD");
	const job = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(job.status, "failed");
	assert.match(job.message, /其他程序/);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal((await git("diff", "--cached", "--name-only")).trim(), "");
});

test("publish refuses unmanaged build inputs without changing the index", async (t) => {
	const { root, git, store, jobs } = await fixture(t);
	const config = "src/config/siteConfig.ts";
	await mkdir(path.join(root, "src/config"), { recursive: true });
	await writeFile(
		path.join(root, config),
		'export const siteConfig = { title: "Original" };\n',
	);
	await git("add", "--", config);
	await git("commit", "-m", "test: add original config");
	await git("push", "origin", "main");
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Saved by manager\n",
	});
	await jobs.record(saved.path, saved.hash);
	await writeFile(
		path.join(root, config),
		'export const siteConfig = { title: "External edit" };\n',
	);
	const head = await git("rev-parse", "HEAD");
	const index = await git("ls-files", "--stage");
	const job = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(job.status, "failed");
	assert.match(job.message, /未纳入本次发布/);
	assert.ok(job.message.includes(config));
	assert.match(job.message, /管理台.*保存.*终端/);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal(await git("ls-files", "--stage"), index);
	assert.ok(!job.log.some((line) => line.includes("fixture pnpm")));
});

test("publish rechecks unmanaged build inputs after validation", async (t) => {
	const { root, git, store, jobs } = await fixture(t);
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Saved by manager\n",
	});
	await jobs.record(saved.path, saved.hash);
	await writeFile(
		path.join(root, "pnpm-stub.cjs"),
		'const fs = require("node:fs"); if (process.argv[2] === "build") fs.writeFileSync("astro.config.mjs", "export default {};\\n");\n',
	);
	const head = await git("rev-parse", "HEAD");
	const index = await git("ls-files", "--stage");
	const job = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(job.status, "failed");
	assert.match(job.message, /未纳入本次发布.*astro\.config\.mjs/);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal(await git("ls-files", "--stage"), index);
});

const offlinePush = async () => {
	throw new Error("Fixture network connection reset");
};

async function pendingFixture(t) {
	const value = await fixture(t, { pushCommit: offlinePush });
	const saved = await value.store.write({
		...(await value.store.read(POST)),
		content: "# Checked and committed\n",
	});
	await value.jobs.record(saved.path, saved.hash);
	const parent = (await value.git("rev-parse", "HEAD")).trim();
	const job = await finished(
		value.jobs,
		value.jobs.start("publish", { store: value.store }).id,
	);
	assert.equal(job.status, "failed");
	assert.match(job.message, /重试推送/);
	const commit = (await value.git("rev-parse", "HEAD")).trim();
	assert.notEqual(commit, parent);
	return { ...value, parent, commit };
}

test("a failed push survives restart and retries the exact commit without build, save or index changes", async (t) => {
	const { root, git, store, jobs, pnpmPath, parent, commit } =
		await pendingFixture(t);
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Newer local edit\n",
	});
	await jobs.record(saved.path, saved.hash);
	await writeFile(path.join(root, "other.txt"), "keep staged\n");
	await git("add", "--", "other.txt");
	const index = await git("ls-files", "--stage");
	const restarted = createJobs(root, { pnpmPath });
	assert.equal((await restarted.gitState()).pendingPush.canRetry, true);
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "success", result.message);
	assert.ok(!result.log.some((line) => line.includes("fixture pnpm")));
	assert.equal((await git("rev-parse", "HEAD")).trim(), commit);
	assert.equal(
		(await git("rev-list", "--count", `${parent}..HEAD`)).trim(),
		"1",
	);
	assert.equal(await git("ls-files", "--stage"), index);
	assert.equal((await store.read(POST)).content, "# Newer local edit\n");
	const records = JSON.parse(
		await readFile(path.join(root, ".local-manager/session.json"), "utf8"),
	);
	assert.equal(records.find((file) => file.path === POST)?.hash, saved.hash);
	assert.equal((await restarted.gitState()).pendingPush, undefined);
	assert.equal((await git("rev-parse", "origin/main")).trim(), commit);
});

test("repeated network failure retains one pending commit and a visible retry action", async (t) => {
	const { root, git, store, pnpmPath, commit } = await pendingFixture(t);
	const restarted = createJobs(root, { pnpmPath, pushCommit: offlinePush });
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "failed");
	assert.equal((await git("rev-parse", "HEAD")).trim(), commit);
	assert.equal((await restarted.gitState()).pendingPush.canRetry, true);
	assert.ok(!result.log.some((line) => line.includes("fixture pnpm")));
});

test("a lost push acknowledgement is reconciled without creating another commit", async (t) => {
	const { root, git, store, pnpmPath } = await fixture(t);
	const jobs = createJobs(root, {
		pnpmPath,
		pushCommit: async ({ commit }) => {
			await git("push", "origin", `${commit}:refs/heads/main`);
			throw new Error("Fixture response lost after remote accepted commit");
		},
	});
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Already on remote\n",
	});
	await jobs.record(saved.path, saved.hash);
	assert.equal(
		(await finished(jobs, jobs.start("publish", { store }).id)).status,
		"failed",
	);
	const commit = (await git("rev-parse", "HEAD")).trim();
	const restarted = createJobs(root, { pnpmPath });
	assert.equal((await restarted.gitState()).ahead, 0);
	assert.equal((await restarted.gitState()).pendingPush.canRetry, true);
	assert.equal(
		(await finished(restarted, restarted.start("publish", { store }).id))
			.status,
		"success",
	);
	assert.equal((await git("rev-parse", "HEAD")).trim(), commit);
});

test("publication refreshes a stale origin/main cache before interpreting ahead commits", async (t) => {
	const { git, store, jobs, remote } = await fixture(t);
	const old = (await git("rev-parse", "HEAD")).trim();
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Pushed elsewhere\n",
	});
	await jobs.record(saved.path, saved.hash);
	await git("add", "--", POST);
	await git("commit", "-m", "test: accepted remotely");
	await git("push", remote, "HEAD:refs/heads/main");
	await git("update-ref", "refs/remotes/origin/main", old);
	assert.equal((await jobs.gitState()).ahead, 1);
	const result = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(result.status, "success", result.message);
	assert.equal((await jobs.gitState()).ahead, 0);
	assert.ok(!result.log.some((line) => line.includes("fixture pnpm")));
});

test("unrecorded local commits are not automatically published", async (t) => {
	const { git, store, jobs } = await fixture(t);
	await store.write({
		...(await store.read(POST)),
		content: "# Outside the manager\n",
	});
	await git("add", "--", POST);
	await git("commit", "-m", "test: unrelated local commit");
	const before = await git("rev-parse", "origin/main");
	const result = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(result.status, "failed");
	assert.match(result.message, /未由本次管理台/);
	assert.equal(await git("rev-parse", "origin/main"), before);
});

test("pending recovery refuses a changed HEAD and preserves unrelated commits", async (t) => {
	const { root, git, store, pnpmPath } = await pendingFixture(t);
	await writeFile(path.join(root, "other.txt"), "unrelated commit\n");
	await git("add", "--", "other.txt");
	await git("commit", "-m", "test: outside commit after pending publish");
	const head = await git("rev-parse", "HEAD");
	let attempted = false;
	const restarted = createJobs(root, {
		pnpmPath,
		pushCommit: async () => {
			attempted = true;
		},
	});
	assert.equal((await restarted.gitState()).pendingPush.canRetry, false);
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "failed");
	assert.match(result.message, /提交历史已变化/);
	assert.equal(attempted, false);
	assert.equal(await git("rev-parse", "HEAD"), head);
});

test("corrupt recovery data fails closed without changing commits or index", async (t) => {
	const { root, git, store, pnpmPath } = await fixture(t);
	await mkdir(path.join(root, ".local-manager"), { recursive: true });
	await writeFile(
		path.join(root, ".local-manager/pending-push.json"),
		"{broken json",
	);
	const restarted = createJobs(root, { pnpmPath });
	const head = await git("rev-parse", "HEAD");
	const index = await git("ls-files", "--stage");
	assert.equal((await restarted.gitState()).pendingPush.canRetry, false);
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "failed");
	assert.match(result.message, /记录损坏/);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal(await git("ls-files", "--stage"), index);
});

test("the validated tree excludes worktree edits and other staged files arriving just before commit", async (t) => {
	const { root, git, store, pnpmPath } = await fixture(t);
	const jobs = createJobs(root, {
		pnpmPath,
		beforeCommit: async () => {
			await writeFile(path.join(root, POST), "# Later external edit\n");
			await writeFile(path.join(root, "other.txt"), "later staging\n");
			await git("add", "--", "other.txt");
		},
	});
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Exact validated snapshot\n",
	});
	await jobs.record(saved.path, saved.hash);
	const result = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(result.status, "success", result.message);
	assert.equal(
		await git("show", `HEAD:${POST}`),
		"# Exact validated snapshot\n",
	);
	assert.equal((await store.read(POST)).content, "# Later external edit\n");
	assert.equal(
		(await git("diff", "--cached", "--name-only")).trim(),
		"other.txt",
	);
	assert.equal(
		(await git("show", "--pretty=", "--name-only", "HEAD")).trim(),
		POST,
	);
});

test("a restart before commit continues the prepared snapshot without rebuilding", async (t) => {
	const { root, git, store, pnpmPath } = await fixture(t);
	const jobs = createJobs(root, {
		pnpmPath,
		beforeCommit: async () => {
			throw new Error("Fixture interruption before commit");
		},
	});
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Snapshot before interruption\n",
	});
	await jobs.record(saved.path, saved.hash);
	const parent = (await git("rev-parse", "HEAD")).trim();
	assert.equal(
		(await finished(jobs, jobs.start("publish", { store }).id)).status,
		"failed",
	);
	assert.equal((await git("rev-parse", "HEAD")).trim(), parent);
	assert.equal((await jobs.gitState()).pendingPush.prepared, true);
	const newer = await store.write({
		...(await store.read(POST)),
		content: "# Newer saved content\n",
	});
	await jobs.record(newer.path, newer.hash);
	const restarted = createJobs(root, { pnpmPath });
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "success", result.message);
	assert.ok(!result.log.some((line) => line.includes("fixture pnpm")));
	assert.equal(
		await git("show", `HEAD:${POST}`),
		"# Snapshot before interruption\n",
	);
	assert.equal((await store.read(POST)).content, "# Newer saved content\n");
	assert.equal(
		(await git("rev-list", "--count", `${parent}..HEAD`)).trim(),
		"1",
	);
	assert.equal(
		JSON.parse(
			await readFile(path.join(root, ".local-manager/session.json"), "utf8"),
		).find((file) => file.path === POST)?.hash,
		newer.hash,
	);
});

test("a restart between commit and journal update recognizes the exact prepared tree", async (t) => {
	const { root, git, store, pnpmPath, commit, parent } =
		await pendingFixture(t);
	const file = path.join(root, ".local-manager/pending-push.json");
	const publication = JSON.parse(await readFile(file, "utf8"));
	publication.commit = null;
	await writeFile(file, JSON.stringify(publication));
	const restarted = createJobs(root, { pnpmPath });
	const pending = (await restarted.gitState()).pendingPush;
	assert.equal(pending.commit, commit);
	assert.equal(pending.prepared, false);
	const result = await finished(
		restarted,
		restarted.start("publish", { store }).id,
	);
	assert.equal(result.status, "success", result.message);
	assert.equal((await git("rev-parse", "HEAD")).trim(), commit);
	assert.equal(
		(await git("rev-list", "--count", `${parent}..HEAD`)).trim(),
		"1",
	);
	assert.ok(!result.log.some((line) => line.includes("fixture pnpm")));
});

test("snapshot verification failure preserves a newer external staging of the same file", async (t) => {
	const { root, git, store, pnpmPath } = await fixture(t);
	let externalIndex;
	const jobs = createJobs(root, {
		pnpmPath,
		afterStage: async () => {
			await writeFile(path.join(root, POST), "# External staged version\n");
			await git("add", "--", POST);
			externalIndex = await git("ls-files", "--stage");
		},
	});
	const saved = await store.write({
		...(await store.read(POST)),
		content: "# Validated manager version\n",
	});
	await jobs.record(saved.path, saved.hash);
	const head = await git("rev-parse", "HEAD");
	const result = await finished(jobs, jobs.start("publish", { store }).id);
	assert.equal(result.status, "failed");
	assert.match(result.message, /暂存内容与已检查版本不一致/);
	assert.match(result.message, /暂存区已保留/);
	assert.equal(await git("ls-files", "--stage"), externalIndex);
	assert.equal(await git("rev-parse", "HEAD"), head);
	assert.equal((await store.read(POST)).content, "# External staged version\n");
});
