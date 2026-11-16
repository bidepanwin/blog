/**
 * 相册管理（本地管理台专用）。
 *
 * 数据契约见 public/images/albums/README.md：每个相册一个目录，
 * 目录内 info.json 为元数据，cover.webp / cover.jpg 为封面，
 * 其余图片由 album-scanner.ts 自动扫描。这里只做「读、校验、构造写入内容」，
 * 真正的写盘与备份统一交给 store.write / store.upload，避免绕过版本校验。
 */
import * as fs from "node:fs/promises";
import path from "node:path";

const fail = (message, status = 400) =>
	Object.assign(new Error(message), { status });

const PREFIX = "public/images/albums";
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const IMAGE = /\.(?:jpe?g|png|webp|gif|avif)$/iu;
const COVER = /^cover\.(?:webp|jpg)$/iu;

function safeId(value) {
	if (typeof value !== "string" || !ID.test(value))
		throw fail("相册标识需使用英文小写、数字与连字符，且以字母或数字开头。");
	return value;
}

function infoPath(id) {
	return `${PREFIX}/${safeId(id)}/info.json`;
}

function albumDirectory(id) {
	return `${PREFIX}/${safeId(id)}`;
}

/** 站点时区（Asia/Shanghai）的今天，用于新建相册的默认日期。 */
function today() {
	return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function textValue(values, key, max) {
	if (values[key] === undefined) return undefined;
	if (typeof values[key] !== "string" || values[key].length > max)
		throw fail(`「${key}」需为不超过 ${max} 字的文字。`);
	return values[key];
}

/** 只接受可视化表单覆盖的字段；其余字段（mode / photos / cover 等）原样保留。 */
export function validateAlbumValues(values) {
	if (!values || typeof values !== "object" || Array.isArray(values))
		throw fail("相册内容格式不正确。");
	const clean = {};
	for (const [key, max] of [
		["title", 200],
		["description", 2000],
		["location", 200],
		["password", 200],
		["passwordHint", 200],
	]) {
		const value = textValue(values, key, max);
		if (value !== undefined) clean[key] = value;
	}
	if (!clean.title?.trim()) throw fail("相册标题不能为空。");
	if (values.date !== undefined) {
		if (
			typeof values.date !== "string" ||
			!/^\d{4}-\d{2}-\d{2}$/u.test(values.date)
		)
			throw fail("日期需填写 YYYY-MM-DD，或留空使用原有值。");
		clean.date = values.date;
	}
	if (values.tags !== undefined) {
		if (
			!Array.isArray(values.tags) ||
			values.tags.length > 30 ||
			!values.tags.every((tag) => typeof tag === "string")
		)
			throw fail("标签需为不超过 30 项的文字列表。");
		clean.tags = values.tags.map((tag) => tag.trim()).filter(Boolean);
	}
	if (values.layout !== undefined) {
		if (!["masonry", "grid"].includes(values.layout))
			throw fail("布局只能是 masonry 或 grid。");
		clean.layout = values.layout;
	}
	if (values.columns !== undefined) {
		const columns = Number(values.columns);
		if (![2, 3, 4].includes(columns)) throw fail("列数只能是 2、3 或 4。");
		clean.columns = columns;
	}
	if (values.hidden !== undefined) {
		if (typeof values.hidden !== "boolean")
			throw fail("「从列表隐藏」需为是/否。");
		clean.hidden = values.hidden;
	}
	return clean;
}

export function createAlbums(store, root) {
	const absoluteRoot = path.join(root, PREFIX);

	/** 下一个零填充照片序号；与相册扫描器的 numeric-aware 排序一致。 */
	async function nextPhotoName(id) {
		let files = [];
		try {
			files = await fs.readdir(path.join(absoluteRoot, id), {
				withFileTypes: true,
			});
		} catch {
			files = [];
		}
		const used = new Set(
			files
				.filter((item) => item.isFile())
				.map((item) => path.basename(item.name, path.extname(item.name))),
		);
		let index = 1;
		while (used.has(String(index).padStart(2, "0"))) index += 1;
		return String(index).padStart(2, "0");
	}

	async function list() {
		let entries;
		try {
			entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
		} catch (error) {
			if (error.code === "ENOENT") return [];
			throw error;
		}
		const albums = [];
		for (const entry of entries) {
			if (!entry.isDirectory() || !ID.test(entry.name)) continue;
			const id = entry.name;
			const filePath = infoPath(id);
			let info = null;
			let hash = null;
			let infoError = "";
			try {
				const file = await store.read(filePath);
				hash = file.hash;
				const parsed = JSON.parse(file.content);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
					throw new Error("not an object");
				info = parsed;
			} catch (error) {
				infoError =
					error.status === 404
						? "缺少 info.json"
						: "info.json 无法解析，请用「源文件」修复";
			}
			let files = [];
			try {
				files = await fs.readdir(path.join(absoluteRoot, id), {
					withFileTypes: true,
				});
			} catch {
				files = [];
			}
			const images = files
				.filter((item) => item.isFile() && IMAGE.test(item.name))
				.map((item) => item.name)
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
			const coverName = images.find((name) => COVER.test(name)) || null;
			const photos = images
				.filter((name) => name !== coverName)
				.map((name) => ({ name, path: `${albumDirectory(id)}/${name}` }));
			albums.push({
				id,
				path: filePath,
				hash,
				info,
				infoError,
				photos,
				coverPath: coverName ? `${albumDirectory(id)}/${coverName}` : null,
			});
		}
		return albums.sort(
			(a, b) =>
				String(b.info?.date || "").localeCompare(String(a.info?.date || "")) ||
				a.id.localeCompare(b.id),
		);
	}

	/** 返回 store.write 所需的写入描述，由 server 统一落盘与记录备份。 */
	async function save(payload) {
		const id = safeId(payload?.id);
		const filePath = infoPath(id);
		const file = await store.read(filePath);
		let existing;
		try {
			existing = JSON.parse(file.content);
		} catch {
			throw fail("info.json 不是有效 JSON，请先用「源文件」修复。");
		}
		if (!existing || typeof existing !== "object" || Array.isArray(existing))
			throw fail("info.json 顶层需为对象。");
		const clean = validateAlbumValues(payload.values);
		const merged = { ...existing, ...clean };
		for (const key of ["password", "passwordHint"])
			if (merged[key] === "") delete merged[key];
		return {
			path: filePath,
			hash: file.hash,
			content: `${JSON.stringify(merged, null, 2)}\n`,
			create: false,
		};
	}

	async function create(payload) {
		const id = safeId(payload?.id);
		const filePath = infoPath(id);
		const existing = await store.read(filePath).catch((error) => {
			if (error.status === 404) return null;
			throw error;
		});
		if (existing) throw fail("这个相册标识已存在。", 409);
		const title =
			typeof payload.title === "string" && payload.title.trim()
				? payload.title.trim().slice(0, 200)
				: id;
		const info = {
			title,
			description: "",
			date: today(),
			location: "",
			tags: [],
			layout: "masonry",
			columns: 3,
			hidden: false,
		};
		return {
			path: filePath,
			content: `${JSON.stringify(info, null, 2)}\n`,
			create: true,
		};
	}

	async function upload(payload) {
		const id = safeId(payload?.id);
		const directory = albumDirectory(id);
		// 只允许向已存在的相册目录写图，避免凭空创建目录。
		await store.read(infoPath(id));
		const name = typeof payload.name === "string" ? payload.name : "";
		if (!IMAGE.test(name))
			throw fail("只支持 JPEG / PNG / WebP / GIF / AVIF 图片。");
		if (typeof payload.data !== "string") throw fail("图片数据格式不正确。");
		const asCover = payload.asCover === true;
		// 扫描器优先读取 cover.webp。固定封面格式可避免 cover.jpg / cover.webp
		// 同时存在时旧封面盖住新封面，也无需删除用户已有的图片。
		if (asCover && !/\.webp$/iu.test(name))
			throw fail("封面请使用 WebP 图片（会保存为 cover.webp）。");
		return store.upload({
			name,
			data: payload.data,
			directory,
			filename: asCover ? "cover" : await nextPhotoName(id),
			overwrite: asCover,
		});
	}

	/**
	 * 从图片素材库复制已有文件到相册目录。
	 * 源路径必须命中 store.listMedia() 的 allowlist，避免读取任意文件；
	 * 写盘沿用 store.upload 的签名校验、10 MiB 限制与原子写。
	 */
	async function importFromLibrary(payload) {
		const id = safeId(payload?.id);
		const directory = albumDirectory(id);
		await store.read(infoPath(id));
		const source = typeof payload.path === "string" ? payload.path : "";
		const { files } = await store.listMedia();
		if (!files.some((file) => file.path === source))
			throw fail("请选择素材库中已有的图片。", 404);
		const asCover = payload.asCover === true;
		if (asCover && !/\.webp$/iu.test(source))
			throw fail("封面请使用 WebP 素材（会保存为 cover.webp）。");
		const bytes = await fs.readFile(path.join(root, source));
		return store.upload({
			name: path.basename(source),
			data: bytes.toString("base64"),
			directory,
			filename: asCover ? "cover" : await nextPhotoName(id),
			overwrite: asCover,
		});
	}

	return { list, save, create, upload, importFromLibrary };
}
