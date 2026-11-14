import path from "node:path";
import { fileURLToPath } from "node:url";

const HTTP = /^https?:\/\//i;
const DRIVE = /^[a-z]:[\\/]/i;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

function fail(message, status = 400) {
	return Object.assign(new Error(message), { status });
}

function text(value, name, optional = false) {
	if (optional && (value === undefined || value === null)) return "";
	if (
		typeof value !== "string" ||
		value.length > 4096 ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Paths must not contain control characters.
		/[\x00-\x1f\x7f]/u.test(value)
	)
		throw fail(`${name}必须是有效的图片路径。`);
	const trimmed = value.trim();
	return /^(["']).*\1$/u.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function decode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		throw fail("图片路径包含无效的编码，请重新复制路径。");
	}
}

function rootRelative(value, root) {
	const windows = DRIVE.test(value) || value.startsWith("//");
	const paths = windows ? path.win32 : path;
	if (!paths.isAbsolute(value)) return null;
	// A leading slash may be a website URL. Only Windows drive/UNC paths or an
	// absolute path actually below the current root are treated as disk paths.
	const child = paths.relative(root, value);
	if (
		child === ".." ||
		child.startsWith(`..${paths.sep}`) ||
		paths.isAbsolute(child)
	) {
		if (windows)
			throw fail("这张图片不在博客项目内，请使用“选择本地图片”将它导入。");
		return null;
	}
	return child.replaceAll("\\", "/");
}

function stripBase(value, base) {
	const prefix = `/${String(base || "/").replace(/^\/+|\/+$/g, "")}/`;
	let result = value;
	if (prefix !== "//") {
		// Accept a copied deployed URL, including an accidentally doubled base.
		while (result.startsWith(prefix))
			result = `/${result.slice(prefix.length)}`;
	}
	return result;
}

/** One stored reference format for all public files and source image assets. */
export function mediaReference(file) {
	if (file.startsWith("public/"))
		return `/${file.split("/").slice(1).map(encodeURIComponent).join("/")}`;
	return file.slice("src/".length);
}

/**
 * Resolve user-entered paths against an already verified media allowlist.
 * No filesystem reads or remote requests occur here; callers supply the list
 * produced by the store's symlink-safe scanner.
 */
export function resolveMediaReference(
	input,
	{ root, files, base = "/", siteUrl = "" },
) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw fail("请提供图片路径。");
	let reference = text(input.reference, "图片路径");
	const prefix = text(input.prefix, "路径前缀", true);
	const documentPath = text(
		input.documentPath,
		"内容文件路径",
		true,
	).replaceAll("\\", "/");
	if (!reference) throw fail("请先选择图片或填写图片路径。");
	if (
		documentPath &&
		(path.posix.isAbsolute(documentPath) ||
			DRIVE.test(documentPath) ||
			path.posix.normalize(documentPath).startsWith("../"))
	)
		throw fail("内容文件路径必须位于博客项目内。");

	if (/^file:/i.test(reference)) {
		try {
			reference = fileURLToPath(reference);
		} catch {
			throw fail("无法读取此本地文件路径，请使用“选择本地图片”。");
		}
	}
	const normalized = reference.replaceAll("\\", "/");
	const rooted =
		HTTP.test(reference) ||
		DRIVE.test(reference) ||
		normalized.startsWith("/") ||
		/^(?:public\/|src\/assets\/images\/|assets\/images\/)/.test(normalized);
	if (prefix && !rooted) {
		if (HTTP.test(prefix)) {
			try {
				reference = new URL(reference, `${prefix.replace(/\/+$/, "")}/`).href;
			} catch {
				throw fail("图片地址或路径前缀无效。");
			}
		} else reference = `${prefix.replace(/[\\/]+$/, "")}/${reference}`;
	}

	if (HTTP.test(reference)) {
		let remote;
		try {
			remote = new URL(reference);
		} catch {
			throw fail("图片网址无效。");
		}
		let ownSite = false;
		try {
			ownSite = Boolean(siteUrl) && remote.origin === new URL(siteUrl).origin;
		} catch {}
		if (!ownSite)
			return {
				kind: "remote",
				reference: remote.href,
				markdownReference: remote.href,
			};
		reference = remote.pathname;
	} else if (SCHEME.test(reference) && !DRIVE.test(reference))
		throw fail("仅支持本地图片路径或 http/https 图片网址。");

	let value = reference.replaceAll("\\", "/");
	const onDisk = rootRelative(value, root);
	if (onDisk !== null) value = onDisk;
	else value = stripBase(value, base);
	// Query/hash delimiters belong to a URL; encoded characters in filenames
	// are decoded only after removing these delimiters.
	value = decode(value.split(/[?#]/, 1)[0]);
	const clean = path.posix.normalize(value).replace(/^\.\//, "");
	const withoutSlash = clean.replace(/^\/+/, "");
	const candidates = [];
	if (withoutSlash.startsWith("public/")) candidates.push(withoutSlash);
	else if (withoutSlash.startsWith("src/assets/images/"))
		candidates.push(withoutSlash);
	else if (withoutSlash.startsWith("assets/images/"))
		candidates.push(`src/${withoutSlash}`, `public/${withoutSlash}`);
	else {
		if (!clean.startsWith("/") && documentPath)
			candidates.push(
				path.posix.normalize(
					path.posix.join(path.posix.dirname(documentPath), clean),
				),
			);
		candidates.push(`public/${withoutSlash}`);
	}

	const insensitive = DRIVE.test(root) || process.platform === "win32";
	const key = (file) => (insensitive ? file.toLowerCase() : file);
	const allowlist = new Map(files.map((file) => [key(file.path), file]));
	const file = candidates
		.map((candidate) => allowlist.get(key(candidate)))
		.find(Boolean);
	if (!file)
		throw fail(
			"找不到这张本地图片。请检查前缀与文件名，或使用“选择本地图片”导入。",
			404,
		);
	const stored = mediaReference(file.path);
	const markdownReference =
		file.path.startsWith("public/") || !documentPath
			? stored
			: path.posix.relative(path.posix.dirname(documentPath), file.path);
	return {
		kind: "local",
		path: file.path,
		reference: stored,
		markdownReference,
	};
}
