import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import {
	newDocument,
	readSettings,
	splitDocument,
	updateDocument,
	updateSettings,
} from "./documents.mjs";
import { createJobs } from "./jobs.mjs";
import { createStore } from "./store.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const UI = fileURLToPath(new URL("./ui/", import.meta.url));
const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".gif": "image/gif",
};
const markdown = new MarkdownIt({
	html: false,
	linkify: false,
	typographer: false,
});
const fail = (message, status = 400) =>
	Object.assign(new Error(message), { status });

export function renderPreview(value) {
	if (typeof value !== "string" || Buffer.byteLength(value) > 1024 * 1024)
		throw fail("预览内容过大。", 413);
	return sanitizeHtml(markdown.render(value), {
		allowedTags: [
			...sanitizeHtml.defaults.allowedTags,
			"img",
			"h1",
			"h2",
			"del",
			"s",
			"input",
		],
		allowedAttributes: {
			a: ["href", "title"],
			img: ["src", "alt", "title"],
			code: ["class"],
			input: ["type", "checked", "disabled"],
		},
		allowedSchemes: ["http", "https", "mailto"],
		allowProtocolRelative: false,
		transformTags: {
			a: sanitizeHtml.simpleTransform("a", {
				rel: "noreferrer noopener",
				target: "_blank",
			}),
		},
	});
}

async function bodyJson(req) {
	if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
		throw fail("请使用 JSON 请求。", 415);
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 15 * 1024 * 1024) throw fail("请求过大，图片最多 10 MB。", 413);
		chunks.push(chunk);
	}
	try {
		const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error();
		return value;
	} catch {
		throw fail("无法读取请求数据。");
	}
}

function hasToken(actual, expected) {
	if (typeof actual !== "string") return false;
	const a = Buffer.from(actual);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function createManagerServer({
	root = ROOT,
	token = randomBytes(32).toString("hex"),
	jobs: providedJobs,
} = {}) {
	const store = createStore(root);
	const jobs = providedJobs || createJobs(root);
	let mutation = Promise.resolve();
	function mutate(operation) {
		const next = mutation.then(async () => {
			if (jobs.isRunning?.())
				throw fail("检查或发布时暂不能保存，请等待任务结束。", 409);
			return operation();
		});
		mutation = next.catch(() => {});
		return next;
	}
	async function save(payload) {
		const saved = await store.write(payload);
		await jobs.record(saved.path, saved.hash);
		return saved;
	}
	async function siteInfo() {
		const file = await store.read("src/config/siteConfig.ts").catch(() => null);
		const fields = file ? readSettings(file.content) : [];
		const value = (key) => fields.find((field) => field.key === key)?.value;
		const base = typeof value("base") === "string" ? value("base") : "/blog/";
		return {
			siteUrl: value("site") || "https://bidepanwin.github.io/blog/",
			base,
			previewUrl: `http://127.0.0.1:4321${base === "/" ? "/" : `/${base.replace(/^\/+|\/+$/g, "")}/`}`,
			timeZone: value("timeZone") || "Asia/Shanghai",
		};
	}
	const server = http.createServer(async (req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		res.setHeader("X-Frame-Options", "DENY");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' blob: about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
		);
		const json = (value, status = 200) => {
			res.writeHead(status, {
				"Content-Type": "application/json; charset=utf-8",
			});
			res.end(JSON.stringify(value));
		};
		try {
			const port = server.address()?.port;
			const expectedHost = `127.0.0.1:${port}`;
			const origin = `http://${expectedHost}`;
			if (req.headers.host !== expectedHost)
				throw fail("仅允许从本机管理台访问。", 403);
			const url = new URL(req.url, origin);
			const route = url.pathname;
			const method = req.method;
			// The scriptless preview has an opaque origin. It can load the public
			// stylesheet and token-protected raster images, never other APIs or UI.
			const previewResource =
				method === "GET" && (route === "/style.css" || route === "/api/media");
			if (
				req.headers.origin &&
				req.headers.origin !== origin &&
				!(previewResource && req.headers.origin === "null")
			)
				throw fail("请求来源不受信任。", 403);
			if (req.headers["sec-fetch-site"] === "cross-site" && !previewResource)
				throw fail("不允许跨站请求。", 403);
			if (route.startsWith("/api/")) {
				const supplied =
					req.headers["x-manager-token"] ||
					(route === "/api/media" && url.searchParams.get("token"));
				if (!hasToken(supplied, token))
					throw fail("管理会话已失效，请刷新页面。", 403);
				if (!["GET", "HEAD"].includes(method) && req.headers.origin !== origin)
					throw fail("修改操作必须来自本机管理台。", 403);
				if (method === "GET" && route === "/api/state") {
					const [catalog, media, git, info] = await Promise.all([
						store.catalog(),
						store.listMedia(),
						jobs.gitState(),
						siteInfo(),
					]);
					return json({
						files: catalog.files,
						media: media.files,
						git,
						...info,
					});
				}
				if (method === "GET" && route === "/api/file")
					return json(await store.read(url.searchParams.get("path")));
				if (method === "GET" && route === "/api/document") {
					const file = await store.read(url.searchParams.get("path"));
					if (!/\.mdx?$/.test(file.path)) throw fail("此文件不是 Markdown。");
					const { frontmatter, body } = splitDocument(file.content);
					return json({ ...file, frontmatter, body });
				}
				if (method === "PUT" && route === "/api/file") {
					const payload = await bodyJson(req);
					return json(await mutate(() => save(payload)));
				}
				if (method === "PUT" && route === "/api/document") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () => {
							const file = await store.read(payload.path);
							if (!/\.mdx?$/.test(file.path))
								throw fail("此文件不是 Markdown。");
							return save({
								path: file.path,
								hash: payload.hash,
								content: updateDocument(
									file.content,
									payload.frontmatter,
									payload.body,
								),
							});
						}),
					);
				}
				if (method === "DELETE" && route === "/api/file") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () => {
							const result = await store.remove(payload);
							await jobs.record(payload.path, null);
							return result;
						}),
					);
				}
				if (method === "GET" && route === "/api/settings") {
					const file = await store.read(url.searchParams.get("path"));
					if (!/^src\/config\/[^/]+\.ts$/.test(file.path))
						throw fail("请选择站点配置文件。");
					return json({
						path: file.path,
						hash: file.hash,
						fields: readSettings(file.content),
					});
				}
				if (method === "PATCH" && route === "/api/settings") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () => {
							const file = await store.read(payload.path);
							if (!/^src\/config\/[^/]+\.ts$/.test(file.path))
								throw fail("请选择站点配置文件。");
							return save({
								path: file.path,
								hash: payload.hash,
								content: updateSettings(file.content, payload.values),
							});
						}),
					);
				}
				if (method === "POST" && route === "/api/new") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () =>
							save({
								...newDocument(payload, (await siteInfo()).timeZone),
								create: true,
							}),
						),
					);
				}
				if (method === "POST" && route === "/api/upload") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () => {
							const uploaded = await store.upload(payload);
							const bytes = await readFile(path.join(root, uploaded.path));
							await jobs.record(
								uploaded.path,
								createHash("sha256").update(bytes).digest("hex"),
							);
							return uploaded;
						}),
					);
				}
				if (method === "GET" && route === "/api/media") {
					const file = (await store.listMedia()).files.find(
						(item) => item.path === url.searchParams.get("path"),
					);
					if (!file) throw fail("图片不存在。", 404);
					res.writeHead(200, {
						"Content-Type":
							MIME[path.extname(file.path).toLowerCase()] ||
							"application/octet-stream",
					});
					return res.end(await readFile(path.join(root, file.path)));
				}
				if (method === "POST" && route === "/api/media/resolve") {
					const payload = await bodyJson(req);
					return json(await store.resolveMedia(payload, await siteInfo()));
				}
				if (method === "POST" && route === "/api/media/import") {
					const payload = await bodyJson(req);
					return json(
						await mutate(async () => {
							const imported = await store.importMedia(
								payload,
								await siteInfo(),
							);
							if (imported.imported) {
								const bytes = await readFile(path.join(root, imported.path));
								await jobs.record(
									imported.path,
									createHash("sha256").update(bytes).digest("hex"),
								);
							}
							return imported;
						}),
					);
				}
				if (method === "GET" && route === "/api/history")
					return json(await store.history());
				if (method === "POST" && route === "/api/restore") {
					const { id } = await bodyJson(req);
					return json(
						await mutate(async () => {
							const restored = await store.restore(id);
							await jobs.record(
								restored.path,
								restored.removed ? null : restored.hash,
							);
							return restored;
						}),
					);
				}
				if (method === "POST" && route === "/api/preview")
					return json({ html: renderPreview((await bodyJson(req)).markdown) });
				if (method === "GET" && route === "/api/job") {
					const job = jobs.get(url.searchParams.get("id"));
					if (!job) throw fail("任务不存在。", 404);
					return json(job);
				}
				if (
					method === "POST" &&
					["/api/validate", "/api/publish"].includes(route)
				) {
					const payload = await bodyJson(req);
					await mutation;
					return json(
						jobs.start(route === "/api/publish" ? "publish" : "validate", {
							message: payload.message,
							store,
						}),
					);
				}
				throw fail("接口不存在。", 404);
			}
			if (method !== "GET" && method !== "HEAD")
				throw fail("不支持此操作。", 405);
			const assets = {
				"/": ["index.html", "text/html; charset=utf-8"],
				"/app.js": ["app.js", "text/javascript; charset=utf-8"],
				"/media-picker.js": [
					"media-picker.js",
					"text/javascript; charset=utf-8",
				],
				"/style.css": ["style.css", "text/css; charset=utf-8"],
			};
			const asset = assets[route];
			if (!asset) throw fail("页面不存在。", 404);
			let contents = await readFile(path.join(UI, asset[0]), "utf8");
			if (route === "/")
				contents = contents.replaceAll("__MANAGER_TOKEN__", token);
			res.writeHead(200, { "Content-Type": asset[1] });
			res.end(method === "HEAD" ? "" : contents);
		} catch (cause) {
			const status = cause.status || (cause.code === "ENOENT" ? 404 : 500);
			json(
				{
					error:
						status === 500
							? "本地操作失败，请查看终端或检查文件权限。"
							: cause.message,
				},
				status,
			);
			if (status === 500) console.error("[本地管理台]", cause.message);
		}
	});
	server.requestTimeout = 30_000;
	server.headersTimeout = 15_000;
	server.maxHeadersCount = 50;
	return { server, token, store, jobs };
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const port = Number(process.env.LOCAL_MANAGER_PORT || 4319);
	if (!Number.isInteger(port) || port < 1024 || port > 65535)
		throw new Error("LOCAL_MANAGER_PORT 必须为 1024–65535。");
	const { server } = createManagerServer();
	server.on("error", (cause) => {
		console.error(
			cause.code === "EADDRINUSE"
				? `端口 ${port} 已占用，请关闭其他管理台或修改 LOCAL_MANAGER_PORT。`
				: cause.message,
		);
		process.exitCode = 1;
	});
	server.listen(port, "127.0.0.1", () => {
		console.log(
			`\n  博客本地管理台：http://127.0.0.1:${port}/\n  只在本机可用；保存写入本地文件，点击发布才会提交推送。\n  另一个终端运行 pnpm.cmd dev --host 127.0.0.1 --port 4321 可预览站点。\n`,
		);
		if (process.argv.includes("--open") && process.platform === "win32") {
			const browser = spawn(
				"cmd.exe",
				["/d", "/s", "/c", `start "" "http://127.0.0.1:${port}/"`],
				{ windowsHide: true, stdio: "ignore" },
			);
			browser.on("error", () =>
				console.log("请在浏览器中打开上方管理台地址。"),
			);
		}
	});
}
