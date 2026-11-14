import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const SHA = /^[a-f0-9]{40}$/;
const NETWORK =
	/connection (?:was )?reset|recv failure|could not resolve|couldn't resolve|failed to connect|connection timed out|operation timed out|timed? ?out|tls|ssl|schannel|network is unreachable|connection refused|remote end hung up|unexpected disconnect|early eof|http (?:429|5\d\d)|returned error: (?:429|5\d\d)/i;
const AUTH =
	/authentication failed|could not read (?:username|password)|terminal prompts disabled|permission denied|repository not found|returned error: 40[134]|http 40[134]|access denied/i;
const DIVERGED =
	/non-fast-forward|fetch first|would clobber|remote contains work/i;

function failure(code, message, status = 500) {
	return Object.assign(new Error(message), {
		code,
		status,
		retryable: /NETWORK|RATE_LIMIT/.test(code),
	});
}

function gitFailure(cause, timedOut = false) {
	if (cause?.code?.startsWith?.("GIT_")) return cause;
	const details = `${cause?.stderr || ""}\n${cause?.message || cause || ""}`;
	if (AUTH.test(details))
		return failure(
			"GIT_AUTH",
			"GitHub 登录或仓库权限不可用，请在此电脑重新确认 GitHub 登录。",
			401,
		);
	if (DIVERGED.test(details))
		return failure(
			"GIT_DIVERGED",
			"远端已有其他更新，已停止推送以保护远端内容。",
			409,
		);
	if (timedOut || NETWORK.test(details))
		return failure(
			"GIT_NETWORK",
			"Git 推送连接中断或超时。已有本地提交会保留，可以重试。",
			503,
		);
	return failure(
		"GIT_FAILED",
		"Git 命令未能完成，已有本地内容和提交已保留。",
		500,
	);
}

// Raw command output can contain a credential-bearing URL. It is never logged
// or attached to a public error; callers receive only a classified safe error.
function runner(root) {
	return (
		args,
		{ input, timeoutMs = 20_000, maxBuffer = 64 * 1024 * 1024 } = {},
	) =>
		new Promise((resolve, reject) => {
			const child = spawn("git", args, {
				cwd: root,
				windowsHide: true,
				shell: false,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GCM_INTERACTIVE: "never",
					GIT_OPTIONAL_LOCKS: "0",
				},
			});
			let settled = false;
			let bytes = 0;
			const stdout = [];
			const stderr = [];
			const finish = (cause, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				cause ? reject(cause) : resolve(value);
			};
			const timer = setTimeout(() => {
				child.kill();
				child.stdout.destroy();
				child.stderr.destroy();
				finish(gitFailure(null, true));
			}, timeoutMs);
			const collect = (list) => (data) => {
				bytes += data.length;
				if (bytes > maxBuffer) {
					child.kill();
					finish(
						failure("GIT_LIMIT", "Git 输出超出安全大小限制，已停止操作。"),
					);
				} else list.push(data);
			};
			child.stdout.on("data", collect(stdout));
			child.stderr.on("data", collect(stderr));
			child.on("error", (cause) => finish(gitFailure(cause)));
			child.on("close", (code) => {
				if (code === 0) finish(null, Buffer.concat(stdout));
				else
					finish(
						gitFailure({ stderr: Buffer.concat(stderr).toString("utf8") }),
					);
			});
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		});
}

function utf8(bytes) {
	const buffer = Buffer.from(bytes);
	const value = buffer.toString("utf8");
	if (!Buffer.from(value).equals(buffer))
		throw failure(
			"GIT_UNSUPPORTED",
			"备用推送暂不支持此 Git 路径或提交编码。",
			409,
		);
	return value;
}

async function gitText(git, args) {
	return utf8(await git(args)).trim();
}

async function bindRemote(git, expectedRemote) {
	const url = await gitText(git, ["remote", "get-url", "origin"]);
	const changed = () =>
		failure(
			"REMOTE_CHANGED",
			"仓库地址在操作期间发生变化，已停止发布。请重新打开发布面板确认仓库。",
			409,
		);
	if (expectedRemote !== undefined && expectedRemote !== url) throw changed();
	return {
		url,
		assertUnchanged: async () => {
			if ((await gitText(git, ["remote", "get-url", "origin"])) !== url)
				throw changed();
		},
	};
}

function githubRepository(origin) {
	let match = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(origin);
	if (!match) {
		try {
			const value = new URL(origin);
			if (
				value.hostname !== "github.com" ||
				value.port ||
				value.search ||
				value.hash ||
				value.password
			)
				return null;
			if (value.protocol === "https:" && value.username) return null;
			if (value.protocol === "ssh:" && value.username !== "git") return null;
			if (!["https:", "ssh:"].includes(value.protocol)) return null;
			match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(value.pathname);
		} catch {
			return null;
		}
	}
	if (
		!match ||
		[".", ".."].includes(match[1]) ||
		[".", ".."].includes(match[2])
	)
		return null;
	return `${match[1]}/${match[2]}`;
}

function retryDelay(response) {
	const raw = response?.headers?.get?.("retry-after");
	const seconds = Number(raw);
	const requested =
		raw && Number.isFinite(seconds)
			? seconds * 1000
			: raw
				? Date.parse(raw) - Date.now()
				: 750;
	return Math.max(
		0,
		Math.min(Number.isFinite(requested) ? requested : 750, 2000),
	);
}

function githubClient({
	git,
	repository,
	fetchImpl,
	sleep,
	log,
	assertRemote,
}) {
	let token;
	async function credential() {
		if (token) return token;
		let bytes;
		try {
			bytes = Buffer.from(
				await git(
					["-c", "credential.interactive=never", "credential", "fill"],
					{
						input: Buffer.from("protocol=https\nhost=github.com\n\n"),
						timeoutMs: 8000,
					},
				),
			);
			token = utf8(bytes)
				.split(/\r?\n/)
				.find((line) => line.startsWith("password="))
				?.slice(9);
			if (!token) throw new Error("missing credential");
			return token;
		} catch {
			throw failure(
				"GITHUB_AUTH",
				"此电脑现有的 GitHub 凭据不可用，请重新登录 GitHub 后在工作台重试推送。",
				401,
			);
		} finally {
			bytes?.fill(0);
		}
	}
	async function request(method, suffix, body) {
		const authorization = `Bearer ${await credential()}`;
		// Immutable object writes are idempotent by Git SHA. A ref update is never
		// retried blindly: its caller always re-reads main after an unknown result.
		const attempts = method === "PATCH" ? 1 : 2;
		for (let attempt = 0; attempt < attempts; attempt++) {
			await assertRemote();
			let response;
			try {
				response = await fetchImpl(
					`https://api.github.com/repos/${repository}${suffix}`,
					{
						method,
						redirect: "error",
						signal: AbortSignal.timeout(15_000),
						headers: {
							Authorization: authorization,
							Accept: "application/vnd.github+json",
							"X-GitHub-Api-Version": "2022-11-28",
							"User-Agent": "Shirone-local-manager",
							...(body ? { "Content-Type": "application/json" } : {}),
						},
						...(body ? { body: JSON.stringify(body) } : {}),
					},
				);
			} catch {
				if (attempt + 1 < attempts) {
					await sleep(750);
					continue;
				}
				throw failure(
					"GITHUB_NETWORK",
					"GitHub 备用推送通道连接中断或超时，可在工作台重试。",
					503,
				);
			}
			await assertRemote();
			if (response.status === 429 || response.status >= 500) {
				if (attempt + 1 < attempts) {
					log("GitHub 服务暂时繁忙，正在短暂等待后重试。");
					await sleep(retryDelay(response));
					continue;
				}
				throw failure(
					response.status === 429 ? "GITHUB_RATE_LIMIT" : "GITHUB_NETWORK",
					"GitHub 服务暂时繁忙，已有本地提交已保留，可稍后重试。",
					503,
				);
			}
			if (!response.ok) {
				if ([401, 403].includes(response.status))
					throw failure(
						"GITHUB_AUTH",
						"GitHub 凭据或仓库写入权限不可用，请重新确认登录。",
						401,
					);
				throw failure(
					method === "PATCH" ? "REMOTE_CHANGED" : "GITHUB_REJECTED",
					method === "PATCH"
						? "远端在推送期间发生变化，已停止操作以保护远端内容。"
						: `GitHub 拒绝了备用推送请求（HTTP ${response.status}），请检查仓库权限。`,
					409,
				);
			}
			try {
				return await response.json();
			} catch {
				throw failure(
					"GITHUB_RESPONSE",
					"无法核对 GitHub 返回的结果，已有本地提交已保留，请重试确认。",
					503,
				);
			}
		}
	}
	return {
		request,
		dispose: () => {
			token = undefined;
		},
	};
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read main without refreshing or modifying any local Git reference. */
export async function readRemoteCommit({
	root,
	expectedRemote,
	log = () => {},
	fetchImpl = fetch,
	runGit,
	sleep = defaultSleep,
}) {
	const git = runGit || runner(root);
	const remote = await bindRemote(git, expectedRemote);
	try {
		const result = await gitText(git, [
			"ls-remote",
			"--exit-code",
			"--heads",
			"--",
			remote.url,
			"refs/heads/main",
		]);
		await remote.assertUnchanged();
		const match = /^([a-f0-9]{40})\s+refs\/heads\/main$/.exec(result);
		if (!match)
			throw failure(
				"REMOTE_MISSING",
				"未能找到远端 main 分支，已停止发布。",
				409,
			);
		return match[1];
	} catch (cause) {
		if (["REMOTE_MISSING", "REMOTE_CHANGED"].includes(cause?.code)) throw cause;
		await remote.assertUnchanged();
		const native = gitFailure(cause);
		if (native.code !== "GIT_NETWORK") throw native;
		const repository = githubRepository(remote.url);
		if (!repository) throw native;
		log("Git 连接暂时不可用，正在通过 GitHub 官方通道核对远端状态。");
		const client = githubClient({
			git,
			repository,
			fetchImpl,
			sleep,
			log,
			assertRemote: remote.assertUnchanged,
		});
		try {
			const ref = await client.request("GET", "/git/ref/heads/main");
			if (
				ref.ref !== "refs/heads/main" ||
				ref.object?.type !== "commit" ||
				!SHA.test(ref.object.sha)
			)
				throw failure(
					"GITHUB_RESPONSE",
					"GitHub 分支状态无效，已停止发布。",
					409,
				);
			return ref.object.sha;
		} catch (apiError) {
			apiError.cause = native;
			throw apiError;
		} finally {
			client.dispose();
		}
	}
}

function objectSha(type, bytes) {
	return createHash("sha1")
		.update(Buffer.from(`${type} ${bytes.length}\0`))
		.update(bytes)
		.digest("hex");
}

function person(line) {
	const match = /^(.*) <([^<>]*)> (\d+) ([+-])(\d{2})(\d{2})$/.exec(line);
	assert.ok(match);
	const [, name, email, seconds, sign, hours, minutes] = match;
	const offset =
		(Number(hours) * 60 + Number(minutes)) * (sign === "+" ? 1 : -1);
	const localTime = new Date(Number(seconds) * 1000 + offset * 60_000)
		.toISOString()
		.slice(0, 19);
	return {
		name,
		email,
		date: `${localTime}${sign}${hours}:${minutes}`,
	};
}

function setEntry(tree, path, entry) {
	const parts = path.split("/");
	assert.ok(parts.every((part) => part && part !== "." && part !== ".."));
	let current = tree;
	for (const part of parts.slice(0, -1)) {
		if (!current.has(part)) current.set(part, new Map());
		current = current.get(part);
		assert.ok(current instanceof Map);
	}
	if (entry) current.set(parts.at(-1), entry);
	else current.delete(parts.at(-1));
}

function hashTree(tree) {
	const hasFiles = (node) =>
		[...node.values()].some(
			(entry) => !(entry instanceof Map) || hasFiles(entry),
		);
	const entries = [...tree].filter(
		([, entry]) => !(entry instanceof Map) || hasFiles(entry),
	);
	entries.sort(([a, av], [b, bv]) =>
		Buffer.compare(
			Buffer.from(a + (av instanceof Map ? "/" : "")),
			Buffer.from(b + (bv instanceof Map ? "/" : "")),
		),
	);
	const bytes = Buffer.concat(
		entries.map(([name, entry]) =>
			Buffer.concat([
				Buffer.from(`${entry instanceof Map ? "40000" : entry.mode} ${name}\0`),
				Buffer.from(entry instanceof Map ? hashTree(entry) : entry.sha, "hex"),
			]),
		),
	);
	return objectSha("tree", bytes);
}

async function assertPinned(git, commit, parent) {
	if (!SHA.test(commit) || !SHA.test(parent))
		throw failure("PENDING_INVALID", "待推送提交记录无效，已停止发布。", 409);
	if (
		(await gitText(git, ["rev-parse", "HEAD"])) !== commit ||
		(await gitText(git, ["symbolic-ref", "--short", "HEAD"])) !== "main"
	)
		throw failure(
			"HEAD_CHANGED",
			"当前分支或提交已发生变化，已停止推送以保护其他修改。",
			409,
		);
	const parents = await gitText(git, [
		"rev-list",
		"--parents",
		"-n",
		"1",
		commit,
	]);
	if (parents !== `${commit} ${parent}`)
		throw failure("PENDING_INVALID", "待推送提交与记录不符，已停止发布。", 409);
}

async function planCommit(git, commit, parent) {
	try {
		const raw = Buffer.from(await git(["cat-file", "commit", commit]));
		assert.equal(objectSha("commit", raw), commit);
		const source = utf8(raw);
		const boundary = source.indexOf("\n\n");
		assert.ok(boundary > 0);
		const headers = source.slice(0, boundary).split("\n");
		assert.equal(headers.length, 4);
		assert.ok(
			headers[0].startsWith("tree ") &&
				headers[1] === `parent ${parent}` &&
				headers[2].startsWith("author ") &&
				headers[3].startsWith("committer "),
		);
		const tree = headers[0].slice(5);
		assert.ok(SHA.test(tree));
		const parentTree = await gitText(git, ["rev-parse", `${parent}^{tree}`]);
		const currentTree = new Map();
		for (const record of utf8(await git(["ls-tree", "-r", "-z", parent]))
			.split("\0")
			.filter(Boolean)) {
			const match = /^(\d+) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(
				record,
			);
			assert.ok(match);
			setEntry(currentTree, match[4], { mode: match[1], sha: match[3] });
		}
		assert.equal(hashTree(currentTree), parentTree);
		const records = utf8(
			await git([
				"diff-tree",
				"--no-commit-id",
				"-r",
				"--raw",
				"--no-renames",
				"--no-ext-diff",
				"--no-textconv",
				"--abbrev=40",
				"-z",
				parent,
				commit,
			]),
		).split("\0");
		const changes = [];
		let bytes = 0;
		for (let index = 0; index < records.length - 1; index += 2) {
			const match = /^:(\d+) (\d+) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMD])$/.exec(
				records[index],
			);
			assert.ok(match);
			const path = records[index + 1];
			const deleted = match[5] === "D";
			assert.equal(match[2], deleted ? "000000" : "100644");
			const content = deleted
				? null
				: Buffer.from(await git(["cat-file", "blob", match[4]]));
			if (content) {
				assert.equal(objectSha("blob", content), match[4]);
				assert.ok(content.length <= 10 * 1024 * 1024);
				bytes += content.length;
			}
			const change = {
				path,
				mode: "100644",
				type: "blob",
				sha: deleted ? null : match[4],
				content,
			};
			changes.push(change);
			setEntry(
				currentTree,
				path,
				deleted ? null : { mode: change.mode, sha: change.sha },
			);
		}
		assert.ok(
			changes.length > 0 && changes.length <= 100 && bytes <= 30 * 1024 * 1024,
		);
		assert.equal(hashTree(currentTree), tree);
		return {
			tree,
			parentTree,
			changes,
			body: {
				tree,
				parents: [parent],
				message: source.slice(boundary + 2),
				author: person(headers[2].slice(7)),
				committer: person(headers[3].slice(10)),
			},
		};
	} catch (cause) {
		if (cause?.code?.startsWith?.("GIT_")) throw cause;
		throw failure(
			"GIT_UNSUPPORTED",
			"备用通道无法精确还原这次提交，已安全停止。可以稍后在工作台重试普通推送。",
			409,
		);
	}
}

/** Push one proven manager-owned commit; this function never commits or stages. */
export async function pushCommit({
	root,
	commit,
	parent,
	expectedRemote,
	log = () => {},
	fetchImpl = fetch,
	runGit,
	sleep = defaultSleep,
}) {
	const git = runGit || runner(root);
	await assertPinned(git, commit, parent);
	const remote = await bindRemote(git, expectedRemote);
	let native;
	for (let attempt = 0; attempt < 2; attempt++) {
		await assertPinned(git, commit, parent);
		await remote.assertUnchanged();
		log(attempt ? "正在重试 Git 推送（2/2）…" : "正在推送已保存的本地提交…");
		try {
			const output = await gitText(git, [
				"-c",
				"http.version=HTTP/1.1",
				"-c",
				"http.lowSpeedLimit=1024",
				"-c",
				"http.lowSpeedTime=10",
				"push",
				"--porcelain",
				"--no-follow-tags",
				"--recurse-submodules=no",
				"--",
				remote.url,
				`${commit}:refs/heads/main`,
			]);
			await remote.assertUnchanged();
			return {
				transport: "git",
				remoteCommit: commit,
				observedRemoteHead: commit,
				alreadyPublished: /up to date/i.test(output),
			};
		} catch (cause) {
			if (cause?.code === "REMOTE_CHANGED") throw cause;
			await remote.assertUnchanged();
			native = gitFailure(cause);
			if (native.code !== "GIT_NETWORK") throw native;
			if (attempt === 0) {
				log("Git 网络连接中断，正在短暂等待后自动重试。");
				await sleep(750);
			}
		}
	}
	await remote.assertUnchanged();
	const repository = githubRepository(remote.url);
	if (!repository) throw native;
	log("Git 连接仍不可用，正在切换到 GitHub 官方备用推送通道。");
	const client = githubClient({
		git,
		repository,
		fetchImpl,
		sleep,
		log,
		assertRemote: remote.assertUnchanged,
	});
	try {
		const plan = await planCommit(git, commit, parent);
		const verifyCommit = async () => {
			const value = await client.request("GET", `/git/commits/${commit}`);
			if (
				value.sha !== commit ||
				value.tree?.sha !== plan.tree ||
				value.parents?.length !== 1 ||
				value.parents[0].sha !== parent
			)
				throw failure(
					"GITHUB_MISMATCH",
					"GitHub 提交内容核对不一致，已停止发布。",
					409,
				);
		};
		const inspectRemote = async () => {
			const ref = await client.request("GET", "/git/ref/heads/main");
			const head = ref.object?.sha;
			if (
				ref.ref !== "refs/heads/main" ||
				ref.object?.type !== "commit" ||
				!SHA.test(head)
			)
				throw failure(
					"GITHUB_RESPONSE",
					"GitHub 分支状态无效，已停止发布。",
					409,
				);
			if (head === parent) return { included: false, head };
			if (head === commit) {
				await verifyCommit();
				return { included: true, head };
			}
			try {
				const comparison = await client.request(
					"GET",
					`/compare/${commit}...${head}?per_page=1`,
				);
				if (
					["ahead", "identical"].includes(comparison.status) &&
					comparison.merge_base_commit?.sha === commit
				) {
					await verifyCommit();
					return { included: true, head };
				}
			} catch (cause) {
				if (cause.code !== "GITHUB_REJECTED") throw cause;
			}
			throw failure(
				"REMOTE_CHANGED",
				"远端已有其他更新，已停止推送以保护远端内容。",
				409,
			);
		};
		const result = async (remote, alreadyPublished) => ({
			transport: "github-api",
			remoteCommit: commit,
			observedRemoteHead: remote.head,
			alreadyPublished,
		});
		const initial = await inspectRemote();
		if (initial.included) return result(initial, true);
		const base = await client.request("GET", `/git/commits/${parent}`);
		if (base.sha !== parent || base.tree?.sha !== plan.parentTree)
			throw failure(
				"GITHUB_MISMATCH",
				"远端基础提交核对不一致，已停止发布。",
				409,
			);
		for (const change of plan.changes) {
			await assertPinned(git, commit, parent);
			if (!change.content) continue;
			const blob = await client.request("POST", "/git/blobs", {
				content: change.content.toString("base64"),
				encoding: "base64",
			});
			if (blob.sha !== change.sha)
				throw failure(
					"GITHUB_MISMATCH",
					"GitHub 文件内容核对不一致，已停止发布。",
					409,
				);
		}
		await assertPinned(git, commit, parent);
		const tree = await client.request("POST", "/git/trees", {
			base_tree: plan.parentTree,
			tree: plan.changes.map(({ path, mode, type, sha }) => ({
				path,
				mode,
				type,
				sha,
			})),
		});
		if (tree.sha !== plan.tree)
			throw failure(
				"GITHUB_MISMATCH",
				"GitHub 文件树核对不一致，已停止发布。",
				409,
			);
		await assertPinned(git, commit, parent);
		const created = await client.request("POST", "/git/commits", plan.body);
		if (created.sha !== commit)
			throw failure(
				"GITHUB_MISMATCH",
				"GitHub 未能精确还原本地提交，已停止发布。",
				409,
			);
		const beforeUpdate = await inspectRemote();
		if (beforeUpdate.included) return result(beforeUpdate, true);
		await assertPinned(git, commit, parent);
		try {
			const ref = await client.request("PATCH", "/git/refs/heads/main", {
				sha: commit,
				force: false,
			});
			if (ref.object?.sha !== commit)
				throw failure(
					"GITHUB_RESPONSE",
					"未收到明确的推送确认，正在重新核对远端状态。",
					503,
				);
		} catch (cause) {
			if (
				!["GITHUB_NETWORK", "GITHUB_RATE_LIMIT", "GITHUB_RESPONSE"].includes(
					cause.code,
				)
			)
				throw cause;
			log("推送确认未完整返回，正在重新核对远端；不会重复创建提交。");
			const observed = await inspectRemote();
			if (observed.included) return result(observed, true);
			throw cause;
		}
		const observed = await inspectRemote();
		if (!observed.included)
			throw failure(
				"GITHUB_RESPONSE",
				"远端尚未确认此次推送，请稍后在工作台重试。",
				503,
			);
		return result(observed, false);
	} catch (cause) {
		cause.cause = native;
		throw cause;
	} finally {
		client.dispose();
	}
}
