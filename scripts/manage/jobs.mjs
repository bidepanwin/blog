import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pushCommit, readRemoteCommit } from "./git-transport.mjs";

function error(message, status = 400) {
	return Object.assign(new Error(message), { status });
}

function affectsBuild(file) {
	return (
		/^(?:src|public|scripts|patches)\//i.test(file) ||
		/^\.github\/(?:workflows|actions)\//i.test(file) ||
		(!file.includes("/") &&
			(/\.(?:[cm]?[jt]sx?|json|ya?ml|toml|lockb?|astro|svelte|html|css|scss|sass|less|styl)$/i.test(
				file,
			) ||
				/^(?:\.gitignore|\.gitattributes|\.gitmodules|\.npmrc|\.pnpmfile\.cjs|\.nvmrc|\.node-version|\.env(?:\..*)?|Dockerfile|Makefile)$/i.test(
					file,
				)))
	);
}

export function createJobs(root, options = {}) {
	const jobs = new Map();
	let active = null;
	const changes = new Map();
	const sessionPath = path.join(root, ".local-manager", "session.json");
	const pendingPath = path.join(root, ".local-manager", "pending-push.json");
	let pending = null;
	let pendingInvalid = false;
	const initialized = Promise.all([
		readFile(sessionPath, "utf8")
			.then((text) => {
				for (const item of JSON.parse(text))
					if (item?.path && typeof item.path === "string")
						changes.set(item.path, item.hash);
			})
			.catch(() => {}),
		readFile(pendingPath, "utf8")
			.then((text) => {
				const value = JSON.parse(text);
				const sha = (x) => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
				if (
					value.version !== 1 ||
					!(
						sha(value.commit) ||
						(value.commit === null &&
							typeof value.message === "string" &&
							value.message.length <= 200 &&
							!/[\r\n\0]/.test(value.message))
					) ||
					!sha(value.parent) ||
					!sha(value.tree) ||
					typeof value.remote !== "string" ||
					!Array.isArray(value.files) ||
					!value.files.length ||
					value.files.some(
						(file) =>
							typeof file.path !== "string" ||
							!(file.hash === null || /^[a-f0-9]{64}$/.test(file.hash)),
					)
				)
					throw new Error("Invalid pending publication");
				pending = value;
			})
			.catch((cause) => {
				if (cause.code !== "ENOENT") pendingInvalid = true;
			}),
	]);
	async function atomicJson(file, value) {
		await mkdir(path.dirname(file), { recursive: true });
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify(value), "utf8");
			await rename(temporary, file);
		} finally {
			await unlink(temporary).catch(() => {});
		}
	}
	async function saveSession() {
		await atomicJson(
			sessionPath,
			[...changes].map(([path, hash]) => ({ path, hash })),
		);
	}
	async function record(file, hash) {
		await initialized;
		changes.set(file, hash);
		await saveSession();
	}

	function command(binary, args, job, { input, env } = {}) {
		return new Promise((resolve, reject) => {
			const child = spawn(binary, args, {
				cwd: root,
				windowsHide: true,
				shell: false,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GCM_INTERACTIVE: "never",
					NO_COLOR: "1",
					...env,
				},
			});
			child.stdin.on("error", () => {});
			child.stdin.end(input);
			let output = "";
			const log = (buffer) => {
				// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal ANSI escape sequences from command logs.
				const text = String(buffer).replace(/\u001b\[[\d;]*m/g, "");
				output += text;
				if (job) {
					job.log.push(...text.split(/\r?\n/).filter(Boolean));
					if (job.log.length > 700) job.log.splice(0, job.log.length - 700);
				}
			};
			child.stdout.on("data", log);
			child.stderr.on("data", log);
			const timeout = setTimeout(
				() => {
					child.kill();
					reject(error("操作超时，请在终端检查。", 500));
				},
				10 * 60 * 1000,
			);
			child.on("error", (cause) => {
				clearTimeout(timeout);
				reject(
					error(
						cause.code === "ENOENT"
							? `未找到 ${binary}，请先安装所需工具。`
							: cause.message,
						500,
					),
				);
			});
			child.on("close", (code) => {
				clearTimeout(timeout);
				code === 0
					? resolve(output)
					: reject(
							error(
								`命令执行失败（${code}）：${binary === "git" ? args[0] : "项目检查"}。查看日志修复后重试。`,
								500,
							),
						);
			});
		});
	}

	function pnpm(args, job) {
		const cli = options.pnpmPath || process.env.npm_execpath;
		if (cli && /pnpm[^/\\]*\.(?:c?js|mjs)$/i.test(cli))
			return command(process.execPath, [cli, ...args], job);
		// Only fixed, server-owned arguments reach the Windows shell fallback.
		if (process.platform === "win32")
			return command(
				process.env.ComSpec || "cmd.exe",
				["/d", "/s", "/c", `pnpm.cmd ${args.join(" ")}`],
				job,
			);
		return command("pnpm", args, job);
	}

	async function assertPending(recorded) {
		let publication = recorded;
		if ((await command("git", ["branch", "--show-current"])).trim() !== "main")
			throw error("待推送发布属于 main 分支，请切回原分支后重试。");
		if (
			(await command("git", ["remote", "get-url", "origin"])).trim() !==
			publication.remote
		)
			throw error("远端仓库已变化，已停止自动重试。");
		const head = (await command("git", ["rev-parse", "HEAD"])).trim();
		if (publication.commit === null && head !== publication.parent)
			publication = { ...publication, commit: head };
		if (head !== (publication.commit || publication.parent))
			throw error("本地提交历史已变化，已停止自动重试，避免推送其他提交。");
		const files = (
			await command("git", [
				"diff-tree",
				"--no-commit-id",
				"--name-only",
				"--no-renames",
				"-r",
				"-z",
				publication.parent,
				publication.tree,
			])
		)
			.split("\0")
			.filter(Boolean)
			.sort();
		if (
			JSON.stringify(files) !==
			JSON.stringify(publication.files.map((file) => file.path).sort())
		)
			throw error("待推送记录与本地提交不一致，已停止自动重试。");
		if (publication.commit === null) return publication;
		const parents = (
			await command("git", ["show", "-s", "--format=%P", publication.commit])
		).trim();
		const tree = (
			await command("git", ["rev-parse", `${publication.commit}^{tree}`])
		).trim();
		if (parents !== publication.parent || tree !== publication.tree)
			throw error("本地提交历史已变化或与恢复记录不一致，已停止自动重试。");
		return publication;
	}
	async function pendingInfo() {
		if (pendingInvalid)
			return {
				commit: "",
				canRetry: false,
				files: [],
				reason: "发布恢复记录损坏，已保留本地提交，请先检查恢复记录。",
			};
		if (!pending) return undefined;
		const result = {
			commit: pending.commit || "",
			parent: pending.parent,
			files: pending.files.map((file) => file.path),
			canRetry: true,
			prepared: pending.commit === null,
		};
		try {
			const resolved = await assertPending(pending);
			result.commit = resolved.commit || "";
			result.prepared = resolved.commit === null;
		} catch (cause) {
			result.canRetry = false;
			result.reason = cause.message;
		}
		return result;
	}
	async function commitSnapshot(publication, job) {
		const index = path.join(
			root,
			".local-manager",
			`publish-${randomUUID()}.index`,
		);
		const env = { GIT_INDEX_FILE: index };
		try {
			// An isolated index commits precisely the validated tree. Git hooks are
			// preserved, while later worktree edits or the user's staging stay separate.
			await command("git", ["read-tree", publication.tree], undefined, { env });
			await command("git", ["commit", "-m", publication.message], job, { env });
			return await assertPending({
				...publication,
				commit: (await command("git", ["rev-parse", "HEAD"])).trim(),
			});
		} finally {
			await unlink(index).catch(() => {});
			await unlink(`${index}.lock`).catch(() => {});
		}
	}
	async function cacheRemote(commit) {
		try {
			await command("git", ["cat-file", "-e", `${commit}^{commit}`]);
		} catch {
			throw error("远端有本机尚未同步的提交，已停止发布，请先同步远端更新。");
		}
		const old = await command("git", [
			"rev-parse",
			"--verify",
			"refs/remotes/origin/main",
		])
			.then((text) => text.trim())
			.catch(() => "0".repeat(40));
		if (old !== commit)
			await command("git", [
				"update-ref",
				"refs/remotes/origin/main",
				commit,
				old,
			]);
	}
	async function resumePush(job) {
		let publication = await assertPending(pending);
		if (publication.commit === null) {
			job.log.push("正在恢复上次已检查的内容快照，无需重复构建。");
			publication = await commitSnapshot(publication, job);
		}
		await atomicJson(pendingPath, publication);
		pending = publication;
		job.log.push(
			`正在推送已检查的提交 ${publication.commit.slice(0, 7)}；不会重复构建或创建提交。`,
		);
		try {
			const result = await (options.pushCommit || pushCommit)({
				root,
				commit: publication.commit,
				parent: publication.parent,
				expectedRemote: publication.remote,
				log: (text) => job.log.push(text),
			});
			if (result.remoteCommit !== publication.commit)
				throw error("无法确认远端已包含本次提交，已保留恢复记录。", 500);
			// A ref is a local cache, not a published branch. Never move the worktree,
			// index or HEAD, or regress a newer remote-tracking cache.
			const cached = (
				await command("git", ["rev-parse", "refs/remotes/origin/main"]).catch(
					() => "",
				)
			).trim();
			let cachedIsNewer = false;
			if (cached)
				cachedIsNewer = await command("git", [
					"merge-base",
					"--is-ancestor",
					publication.commit,
					cached,
				])
					.then(() => true)
					.catch(() => false);
			if (!cachedIsNewer) await cacheRemote(publication.commit);
		} catch (cause) {
			throw error(
				`${cause.message} 本地提交 ${publication.commit.slice(0, 7)} 已保留，可直接点击“重试推送”，不必重新保存或提交。`,
				500,
			);
		}
		for (const file of publication.files)
			if (changes.get(file.path) === file.hash) changes.delete(file.path);
		await saveSession();
		await unlink(pendingPath);
		pending = null;
		job.message =
			"已确认提交同步到 GitHub。GitHub Pages 正在构建，部署成功后线上内容才会更新。";
	}

	async function gitState() {
		await initialized;
		try {
			const raw = await command("git", [
				"-c",
				"core.quotepath=false",
				"status",
				"--porcelain=v1",
				"-z",
				"--untracked-files=all",
			]);
			const entries = raw.split("\0").filter(Boolean);
			const changed = [];
			for (let i = 0; i < entries.length; i++) {
				const item = entries[i];
				changed.push({
					status: item.slice(0, 2),
					path: item.slice(3),
					managed: changes.has(item.slice(3)),
				});
				if (/[RC]/.test(item.slice(0, 2))) i++;
			}
			const branch = (
				await command("git", ["branch", "--show-current"])
			).trim();
			let ahead = 0;
			let behind = 0;
			try {
				const counts = (
					await command("git", [
						"rev-list",
						"--left-right",
						"--count",
						"HEAD...refs/remotes/origin/main",
					])
				)
					.trim()
					.split(/\s+/)
					.map(Number);
				[ahead, behind] = counts;
			} catch {}
			return {
				branch,
				changed,
				ahead,
				behind,
				pendingPush: await pendingInfo(),
			};
		} catch {
			return {
				branch: "",
				changed: [],
				ahead: 0,
				behind: 0,
				unavailable: true,
			};
		}
	}

	async function validate(job) {
		await pnpm(["astro", "check"], job);
		await pnpm(["build"], job);
	}

	async function publish(job, message, store) {
		await initialized;
		if (pendingInvalid)
			throw error("发布恢复记录损坏，已保留本地提交，请先检查恢复记录。");
		if (pending) return resumePush(job);
		let state = await gitState();
		if (state.branch !== "main")
			throw error("请切回 main 分支后发布；后台不会自动切换分支。");
		const origin = (
			await command("git", ["remote", "get-url", "origin"])
		).trim();
		job.log.push("正在重新核对 GitHub 远端提交，避免使用过期的本地推送记录。");
		const remoteHead = await (options.readRemoteCommit || readRemoteCommit)({
			root,
			expectedRemote: origin,
			log: (text) => job.log.push(text),
		});
		if (
			(await command("git", ["remote", "get-url", "origin"])).trim() !== origin
		)
			throw error("核对期间远端仓库发生变化，已停止发布。");
		await cacheRemote(remoteHead);
		state = await gitState();
		if (state.behind > 0)
			throw error("本地落后于远端，请先在终端同步，避免覆盖远端更新。");
		if (state.ahead > 0)
			throw error(
				"存在未由本次管理台发布记录确认的本地提交，已停止自动推送，避免把其他提交一并发布。",
			);
		const baseHead = (await command("git", ["rev-parse", "HEAD"])).trim();
		if (baseHead !== remoteHead)
			throw error("核对期间本地提交发生变化，已停止发布，请刷新后重试。");
		const staged = await command("git", [
			"diff",
			"--cached",
			"--name-only",
			"-z",
		]);
		if (staged.trim())
			throw error(
				"暂存区已有其他修改，请先在终端处理；后台不会把它们混入发布。",
			);
		const files = state.changed
			.filter((item) => item.managed)
			.map((item) => item.path);
		if (!files.length) {
			if (state.changed.some((item) => affectsBuild(item.path)))
				throw error("没有通过此后台保存的待发布文件，外部修改仍保存在本地。");
			job.message = "已核对远端：现有提交均已同步，无需重复提交或推送。";
			return;
		}
		const selected = new Set(files);
		const savedHashes = new Map(files.map((file) => [file, changes.get(file)]));
		const verifiedBlobs = new Map();
		function requireMatchingBuildInputs(current) {
			if (current.unavailable)
				throw error("无法读取 Git 状态，已停止发布。", 500);
			const unmanaged = current.changed.filter(
				(item) => !selected.has(item.path) && affectsBuild(item.path),
			);
			if (unmanaged.length)
				throw error(
					`存在未纳入本次发布的站点或构建修改：${unmanaged.map((item) => item.path).join("、")}。请先用管理台打开并保存可编辑文件，或在终端处理这些修改后再发布。`,
					409,
				);
		}
		requireMatchingBuildInputs(state);
		async function verify() {
			for (const file of files) {
				const hash = savedHashes.get(file);
				if (hash === null) {
					try {
						await store.read(file);
						throw error(`文件重新出现，请重新确认：${file}`, 409);
					} catch (e) {
						if (e.status !== 404) throw e;
					}
					verifiedBlobs.set(file, null);
				} else {
					const media = (await store.listMedia()).files.find(
						(item) => item.path === file,
					);
					if (!media) await store.read(file);
					const bytes = await readFile(path.join(root, file));
					const actual = createHash("sha256").update(bytes).digest("hex");
					if (actual !== hash)
						throw error(`文件已在其他程序中修改，请重新打开保存：${file}`, 409);
					verifiedBlobs.set(
						file,
						(
							await command(
								"git",
								["hash-object", `--path=${file}`, "--stdin"],
								undefined,
								{ input: bytes },
							)
						).trim(),
					);
				}
			}
		}
		await verify();
		await validate(job);
		await verify();
		requireMatchingBuildInputs(await gitState());
		if ((await command("git", ["rev-parse", "HEAD"])).trim() !== baseHead)
			throw error("检查期间提交历史发生变化，已停止发布。");
		if (
			(await command("git", ["remote", "get-url", "origin"])).trim() !== origin
		)
			throw error("检查期间远端仓库发生变化，已停止发布。");
		const stageNow = await command("git", [
			"diff",
			"--cached",
			"--name-only",
			"-z",
		]);
		if (stageNow.trim()) throw error("检查期间暂存区发生变化，已停止发布。");
		await command("git", ["add", "--", ...files], job);
		await options.afterStage?.();
		const validatedTree = (await command("git", ["write-tree"])).trim();
		try {
			const stagedFiles = (
				await command("git", [
					"diff-tree",
					"--name-only",
					"--no-renames",
					"-r",
					"-z",
					baseHead,
					validatedTree,
				])
			)
				.split("\0")
				.filter(Boolean);
			if (stagedFiles.some((file) => !files.includes(file)))
				throw error("暂存区含有本次范围外的文件，已停止发布。");
			for (const file of files) {
				const entry = (
					await command("git", ["ls-tree", "-z", validatedTree, "--", file])
				)
					.split("\0")
					.filter(Boolean);
				const stagedBlob =
					entry.length === 1
						? /^\d+ blob ([a-f0-9]{40})\t/.exec(entry[0])?.[1]
						: null;
				if (stagedBlob !== verifiedBlobs.get(file))
					throw error(`暂存内容与已检查版本不一致，已停止发布：${file}`, 409);
			}
		} catch (cause) {
			// An external editor may have staged a newer version of these same paths.
			// Even a conditional reset races with it, so preserve the index on failure.
			throw error(
				`${cause.message} 暂存区已保留，请先检查暂存内容后重试。`,
				cause.status || 500,
			);
		}
		const publication = {
			version: 1,
			commit: null,
			parent: baseHead,
			tree: validatedTree,
			remote: origin,
			message: message || "content(blog): update blog from local studio",
			files: files.map((path) => ({ path, hash: savedHashes.get(path) })),
		};
		await assertPending(publication);
		await atomicJson(pendingPath, publication);
		pending = publication;
		await options.beforeCommit?.(publication);
		await resumePush(job);
	}

	function start(type, { message, store } = {}) {
		if (active) throw error("已有检查或发布任务在运行，请等待完成。", 409);
		if (type !== "validate" && type !== "publish") throw error("未知任务。");
		if (
			message !== undefined &&
			(typeof message !== "string" ||
				message.length > 200 ||
				/[\r\n\0]/.test(message))
		)
			throw error("提交说明不能换行，最多 200 字。");
		const job = { id: randomUUID(), status: "running", log: [], message: "" };
		jobs.set(job.id, job);
		if (jobs.size > 30) jobs.delete(jobs.keys().next().value);
		active = job.id;
		Promise.resolve()
			.then(() =>
				type === "publish" ? publish(job, message, store) : validate(job),
			)
			.then(() => {
				job.status = "success";
				job.message ||= "检查和构建通过。";
			})
			.catch((cause) => {
				job.status = "failed";
				job.message = cause.message;
				job.log.push(cause.message);
			})
			.finally(() => {
				active = null;
			});
		return { id: job.id, status: job.status };
	}
	return {
		record,
		gitState,
		start,
		isRunning: () => active !== null,
		get: (id) => jobs.get(id),
		command,
		pnpm,
	};
}
