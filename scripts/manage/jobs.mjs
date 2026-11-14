import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
	const initialized = readFile(sessionPath, "utf8")
		.then((text) => {
			for (const item of JSON.parse(text))
				if (item?.path && typeof item.path === "string")
					changes.set(item.path, item.hash);
		})
		.catch(() => {});
	async function record(file, hash) {
		await initialized;
		changes.set(file, hash);
		await mkdir(path.dirname(sessionPath), { recursive: true });
		await writeFile(
			sessionPath,
			JSON.stringify([...changes].map(([path, hash]) => ({ path, hash }))),
			"utf8",
		);
	}

	function command(binary, args, job) {
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
				},
			});
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
						"HEAD...@{upstream}",
					])
				)
					.trim()
					.split(/\s+/)
					.map(Number);
				[ahead, behind] = counts;
			} catch {}
			return { branch, changed, ahead, behind };
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
		const state = await gitState();
		if (state.branch !== "main")
			throw error("请切回 main 分支后发布；后台不会自动切换分支。");
		if (state.behind > 0)
			throw error("本地落后于远端，请先在终端同步，避免覆盖远端更新。");
		if (state.ahead > 0)
			throw error("本地存在尚未推送的提交，请先在终端确认并处理后再发布。");
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
		if (!files.length) throw error("没有通过此后台保存的待发布文件。");
		const selected = new Set(files);
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
				const hash = changes.get(file);
				if (hash === null) {
					try {
						await store.read(file);
						throw error(`文件重新出现，请重新确认：${file}`, 409);
					} catch (e) {
						if (e.status !== 404) throw e;
					}
				} else {
					const media = (await store.listMedia()).files.find(
						(item) => item.path === file,
					);
					const actual = media
						? createHash("sha256")
								.update(await readFile(path.join(root, file)))
								.digest("hex")
						: (await store.read(file)).hash;
					if (actual !== hash)
						throw error(`文件已在其他程序中修改，请重新打开保存：${file}`, 409);
				}
			}
		}
		await verify();
		await validate(job);
		await verify();
		requireMatchingBuildInputs(await gitState());
		const stageNow = await command("git", [
			"diff",
			"--cached",
			"--name-only",
			"-z",
		]);
		if (stageNow.trim()) throw error("检查期间暂存区发生变化，已停止发布。");
		await command("git", ["add", "--", ...files], job);
		try {
			const stagedFiles = (
				await command("git", ["diff", "--cached", "--name-only", "-z"])
			)
				.split("\0")
				.filter(Boolean);
			if (stagedFiles.some((file) => !files.includes(file)))
				throw error("暂存区含有本次范围外的文件，已停止发布。");
			await command(
				"git",
				[
					"commit",
					"-m",
					message || "content(blog): update blog from local studio",
					"--only",
					"--",
					...files,
				],
				job,
			);
		} catch (cause) {
			// Unstage only this tool's paths; do not reset the user's other work.
			await command("git", ["reset", "--", ...files]).catch(() => {});
			throw cause;
		}
		try {
			await command("git", ["push", "origin", "main"], job);
		} catch (cause) {
			throw error(
				`${cause.message} 本地提交已保留，请在终端执行 git push origin main 重试，不必重新保存。`,
				500,
			);
		}
		for (const file of files) changes.delete(file);
		await writeFile(
			sessionPath,
			JSON.stringify([...changes].map(([path, hash]) => ({ path, hash }))),
			"utf8",
		);
		job.message =
			"已提交并推送。GitHub Pages 正在构建，成功后线上内容才会更新。";
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
