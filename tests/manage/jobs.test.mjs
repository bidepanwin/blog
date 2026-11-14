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
async function fixture(t) {
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
	const jobs = createJobs(root, { pnpmPath });
	return { root, git, store, jobs };
}
async function finished(jobs, id) {
	for (let i = 0; i < 200; i++) {
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
