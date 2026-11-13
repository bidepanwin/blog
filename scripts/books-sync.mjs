#!/usr/bin/env node
/**
 * 书单封面同步：从 Open Library 取封面与出版年，落到 public/assets/books/，
 * 并把 cover（以及缺的 yearPublished）写回 src/data/books.ts。
 *
 * 用法：node scripts/books-sync.mjs [--dry-run] [--force]
 *   --dry-run  只打印将要做什么，不写文件
 *   --force    已有本地封面也重新下载
 * 零第三方依赖：只用 Node 内置模块（http/https/net/tls/fs）。
 * 国内访问 Open Library 需代理时设 BOOKS_SYNC_PROXY 或 HTTPS_PROXY。
 *
 * 不会覆盖你手写的 cover（非 /assets/books/ 路径），也不改评分/感想/状态。
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "src", "data", "books.ts");
const OUT_DIR = path.join(ROOT, "public", "assets", "books");
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const UA = "murdok-books-sync/1.0 (https://murdok.me/books/)";
const PROXY =
	process.env.BOOKS_SYNC_PROXY ||
	process.env.HTTPS_PROXY ||
	process.env.https_proxy ||
	"";
const TIMEOUT = 30000;

const slugOf = (b) =>
	b.slug ||
	b.title
		.toLowerCase()
		.replace(/[^a-z0-9一-龥]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

/** 通过 HTTP 代理建立到目标站的 CONNECT 隧道，返回已连上的 socket */
function tunnelViaProxy(target, proxyUrl) {
	return new Promise((resolve, reject) => {
		const p = new URL(proxyUrl);
		const req = http.request({
			host: p.hostname,
			port: Number(p.port || 80),
			method: "CONNECT",
			path: `${target.hostname}:${target.port || 443}`,
			timeout: TIMEOUT,
		});
		req.on("connect", (res, socket) => {
			if (res.statusCode !== 200) {
				socket.destroy();
				reject(new Error(`proxy CONNECT ${res.statusCode}`));
				return;
			}
			resolve(socket);
		});
		req.on("timeout", () => req.destroy(new Error("proxy timeout")));
		req.on("error", reject);
		req.end();
	});
}

/** 拉取 URL，跟随重定向（Open Library 封面会 302 到封面 CDN） */
async function fetchUrl(url, redirects = 3) {
	const u = new URL(url);
	const isHttps = u.protocol === "https:";
	const socket = PROXY ? await tunnelViaProxy(u, PROXY) : undefined;
	const opts = {
		hostname: u.hostname,
		port: Number(u.port || (isHttps ? 443 : 80)),
		path: u.pathname + u.search,
		method: "GET",
		headers: { "user-agent": UA, accept: "*/*" },
		timeout: TIMEOUT,
		// 关闭连接池：让 createConnection 精确接管（否则 undici 风格的多路
		// 拨号会把隧道 socket 复用成 AggregateError）
		agent: false,
	};
	if (socket) {
		opts.createConnection = () =>
			isHttps
				? tls.connect({ socket, servername: u.hostname })
				: socket;
	}
	const lib = isHttps ? https : http;
	return new Promise((resolve, reject) => {
		const req = lib.request(opts, (res) => {
			if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
				res.resume();
				if (redirects <= 0) return reject(new Error("too many redirects"));
				const loc = res.headers.location;
				if (!loc) return reject(new Error("redirect without location"));
				resolve(fetchUrl(new URL(loc, u).href, redirects - 1));
				return;
			}
			if (res.statusCode !== 200) {
				res.resume();
				return reject(new Error(`${res.statusCode} ${url}`));
			}
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () =>
				resolve({
					body: Buffer.concat(chunks),
					type: res.headers["content-type"] || "",
				}),
			);
			res.on("error", reject);
		});
		req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
		req.on("error", reject);
		req.end();
	});
}

/** 统一走 curl：原生支持 HTTPS_PROXY，避开 Node https 与代理隧道/TLS 的坑。 */
function curlArgs(url, extra = []) {
	const proxy = PROXY ? ["-x", PROXY] : [];
	return [
		"-sSL",
		"--max-time",
		"40",
		"--retry",
		"3",
		"--retry-all-errors",
		"--retry-delay",
		"2",
		"-A",
		UA,
		...proxy,
		...extra,
		url,
	];
}

async function getJson(url) {
	const { stdout } = await run("curl", curlArgs(url), {
		maxBuffer: 8 * 1024 * 1024,
	});
	return JSON.parse(stdout);
}

async function downloadImage(url) {
	const { stdout } = await run(
		"curl",
		curlArgs(url, ["-w", "\n%{content_type}"]),
		{ encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
	);
	const nl = stdout.lastIndexOf(0x0a);
	const type = stdout.subarray(nl + 1).toString("utf8").trim();
	const body = stdout.subarray(0, nl);
	if (!type.startsWith("image/")) throw new Error(`not an image: ${type}`);
	if (body.length < 2500) throw new Error(`image too small (${body.length} bytes)`);
	return body;
}

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/** 从 books.ts 里粗解析条目块（逐行匹配字段，文件其它部分原样保留） */
function parseEntries(src) {
	const start = src.indexOf("export const booksData");
	if (start === -1) throw new Error("booksData not found");
	const entries = [];
	const re = /\{([\s\S]*?)\n\t\},/g;
	let m;
	while ((m = re.exec(src.slice(start)))) {
		const body = m[1];
		const pick = (k) => {
			const mm = body.match(new RegExp(`\\b${k}:\\s*"([^"]*)"`));
			return mm ? mm[1] : undefined;
		};
		const title = pick("title");
		if (!title) continue;
		entries.push({
			body,
			slug: pick("slug"),
			title,
			author: pick("author"),
			isbn: pick("isbn"),
			coverId: pick("coverId"),
			cover: pick("cover"),
			yearPublished: pick("yearPublished"),
		});
	}
	return entries;
}

function insertField(body, key, value) {
	if (new RegExp(`\\b${key}:`).test(body)) return body;
	const anchor =
		body.match(/\n\t\tauthor:[^\n]*\n/) || body.match(/\n\t\ttitle:[^\n]*\n/);
	if (!anchor) return body;
	const at = body.indexOf(anchor[0]) + anchor[0].length;
	return `${body.slice(0, at)}\t\t${key}: "${value}",\n${body.slice(at)}`;
}

async function main() {
	if (PROXY) console.log(`books-sync: proxy ${PROXY}`);
	const src = await readFile(DATA_FILE, "utf8");
	const entries = parseEntries(src);
	console.log(`books-sync: ${entries.length} entries`);

	let out = src;
	let changed = 0;
	const failures = [];

	for (const e of entries) {
		const slug = slugOf(e);
		const localPath = path.join(OUT_DIR, `${slug}.jpg`);
		const publicPath = `/assets/books/${slug}.jpg`;
		const isLocalCover = e.cover && e.cover.startsWith("/assets/books/");

		const haveLocal = await exists(localPath);
		let needFetch = !haveLocal || FORCE;
		if (!e.isbn && !haveLocal) {
			console.log(`  · ${slug}: no isbn and no local cover, skip`);
			continue;
		}
		if (e.cover && !isLocalCover && haveLocal) needFetch = false;

		let patchBody = e.body;
		let downloaded = false;

		if (needFetch && e.isbn) {
			try {
				const isbn = e.isbn.replace(/-/g, "");
				if (!e.yearPublished) {
					try {
						const meta = await getJson(`https://openlibrary.org/isbn/${isbn}.json`);
						if (meta.publish_date) {
							const y = String(meta.publish_date).match(/\d{4}/);
							if (y) patchBody = insertField(patchBody, "yearPublished", y[0]);
						}
					} catch (err) {
						console.log(`  · ${slug}: meta ${err.message}`);
					}
				}
				let buf;
				try {
					buf = await downloadImage(
						`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
					);
				} catch (isbnErr) {
					// ISBN 无图：优先用条目写明的 coverId，否则按标题搜一张
					let cid = e.coverId;
					if (!cid) {
						const q = encodeURIComponent(e.title);
						const res = await getJson(
							`https://openlibrary.org/search.json?title=${q}&limit=3`,
						);
						const doc = (res.docs || []).find((d) => d.cover_i);
						cid = doc && doc.cover_i;
					}
					if (!cid) throw isbnErr;
					buf = await downloadImage(
						`https://covers.openlibrary.org/b/id/${cid}-L.jpg?default=false`,
					);
					console.log(`  · ${slug}: isbn 无图，改用 cover id ${cid}`);
				}
				if (!DRY) {
					await mkdir(OUT_DIR, { recursive: true });
					await writeFile(localPath, buf);
				}
				downloaded = true;
				console.log(`  ✓ ${slug}: cover ${Math.round(buf.length / 1024)} KB`);
			} catch (err) {
				failures.push(`${slug}: ${err.message}`);
				console.log(`  ✗ ${slug}: ${err.message}`);
			}
		} else if (haveLocal) {
			console.log(`  · ${slug}: local cover exists`);
		}

		// cover 字段：只在「本地文件确实存在」且「没有手写外链封面」时写入
		const localReady = (await exists(localPath)) || (!DRY && downloaded);
		if (localReady && (!e.cover || isLocalCover)) {
			if (e.cover !== publicPath) {
				if (isLocalCover) {
					patchBody = patchBody.replace(
						/cover:\s*"[^"]*"/,
						`cover: "${publicPath}"`,
					);
				} else {
					patchBody = insertField(patchBody, "cover", publicPath);
				}
			}
		}

		if (patchBody !== e.body) {
			out = out.replace(e.body, patchBody);
			changed += 1;
		}
	}

	if (changed && !DRY) await writeFile(DATA_FILE, out, "utf8");
	console.log(`books-sync: ${changed} entries updated${DRY ? " (dry-run)" : ""}`);
	if (failures.length) {
		console.log(`books-sync: ${failures.length} cover failures (kept placeholder)`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
