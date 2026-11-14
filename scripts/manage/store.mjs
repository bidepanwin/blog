import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	relative,
	resolve,
	win32,
} from "node:path";
import { TextDecoder } from "node:util";
import ts from "typescript";
import { parseDocument } from "yaml";
import { mediaReference, resolveMediaReference } from "./media-paths.mjs";

const MAX_TEXT = 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RASTER = /\.(?:jpe?g|png|webp|gif|avif)$/i;
const FORBIDDEN = new Set(["node_modules", "dist", "research"]);
const SCAN_ROOTS = [
	"src/content",
	"src/config",
	"src/data",
	"public",
	"src/styles",
	"src/i18n/languages",
];

function fail(message, status = 400) {
	return Object.assign(new Error(message), { status });
}

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function segments(path, internal = false) {
	if (
		typeof path !== "string" ||
		!path ||
		path.length > 1024 ||
		path.includes("\\") ||
		isAbsolute(path) ||
		win32.isAbsolute(path)
	) {
		throw fail("A relative path using forward slashes is required.");
	}
	const parts = path.split("/");
	if (
		!internal &&
		parts[0] === "public" &&
		parts[1]?.toLowerCase() === "admin"
	) {
		throw fail("Public administration assets are not editable.");
	}
	for (const part of parts) {
		if (
			!part ||
			part === "." ||
			part === ".." ||
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject ASCII control characters and Windows-invalid path characters.
			/[<>:"|?*\x00-\x1f]/u.test(part) ||
			/[. ]$/u.test(part) ||
			/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
		) {
			throw fail("Invalid path segment.");
		}
		if (
			!internal &&
			(part.startsWith(".") || FORBIDDEN.has(part.toLowerCase()))
		) {
			throw fail("This path is outside the editable folders.");
		}
	}
	return parts;
}

function editable(path) {
	segments(path);
	return (
		/^src\/content\/(?:[^/]+\/)*[^/]+\.mdx?$/u.test(path) ||
		(/^src\/config\/(?:[^/]+\/)*[^/]+\.(?:ts|json|html)$/u.test(path) &&
			basename(path) !== "index.ts") ||
		/^src\/data\/(?:[^/]+\/)*[^/]+\.(?:ts|json|md)$/u.test(path) ||
		/^public\/(?:[^/]+\/)*[^/]+\.(?:json|md|txt)$/u.test(path) ||
		path === "src/styles/personal-blog.css" ||
		/^src\/i18n\/languages\/[^/]+\.ts$/u.test(path)
	);
}

function requireEditable(path) {
	if (!editable(path))
		throw fail("This file is outside the editable allowlist.");
}

function decodeText(bytes) {
	if (bytes.length > MAX_TEXT)
		throw fail("Text files must be at most 1 MiB.", 413);
	let content;
	try {
		content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		throw fail("The file must contain valid UTF-8 text.");
	}
	if (content.includes("\0")) throw fail("Binary content is not editable.");
	return content;
}

function validateContent(path, content) {
	if (typeof content !== "string") throw fail("Content must be a string.");
	const bytes = Buffer.from(content, "utf8");
	if (decodeText(bytes) !== content)
		throw fail("Content contains an invalid Unicode sequence.");
	const extension = extname(path);
	if (extension === ".json") {
		try {
			JSON.parse(content);
		} catch {
			throw fail("Invalid JSON syntax.");
		}
	}
	if (extension === ".ts") {
		// Parse/transpile only: configuration code is never imported or evaluated here.
		const result = ts.transpileModule(content, {
			fileName: basename(path),
			reportDiagnostics: true,
			compilerOptions: {
				target: ts.ScriptTarget.ESNext,
				module: ts.ModuleKind.ESNext,
			},
		});
		const error = result.diagnostics?.find(
			(item) => item.category === ts.DiagnosticCategory.Error,
		);
		if (error)
			throw fail(
				`Invalid TypeScript: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
			);
	}
	if (extension === ".md" || extension === ".mdx") {
		const opening = /^\uFEFF?---[ \t]*\r?\n/u.exec(content);
		if (opening) {
			const rest = content.slice(opening[0].length);
			const ending = /^(?:---|\.\.\.)[ \t]*\r?$/mu.exec(rest);
			if (!ending) throw fail("Markdown frontmatter has no closing delimiter.");
			const doc = parseDocument(rest.slice(0, ending.index));
			if (doc.errors.length)
				throw fail(`Invalid YAML frontmatter: ${doc.errors[0].message}`);
		}
	}
	return bytes;
}

function groupFor(path) {
	if (path.startsWith("src/content/")) return path.split("/")[2];
	if (path.startsWith("src/i18n/")) return "translations";
	if (path.startsWith("src/styles/")) return "styles";
	if (path.startsWith("public/")) return "public";
	return path.split("/")[1];
}

function imageExtension(name, data) {
	if (
		typeof name !== "string" ||
		name.length > 255 ||
		name.includes("/") ||
		name.includes("\\")
	)
		throw fail("A simple image filename is required.");
	segments(name);
	const extension = extname(name).toLowerCase();
	if (!RASTER.test(name))
		throw fail("Only JPEG, PNG, WebP, GIF and AVIF uploads are supported.");
	if (typeof data !== "string" || data.length > Math.ceil(MAX_IMAGE / 3) * 4)
		throw fail("Image uploads must be at most 10 MiB.", 413);
	if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data))
		throw fail("Invalid base64 image data.");
	const bytes = Buffer.from(data, "base64");
	if (bytes.length > MAX_IMAGE)
		throw fail("Image uploads must be at most 10 MiB.", 413);
	if (bytes.toString("base64") !== data)
		throw fail("Invalid base64 image data.");
	let detected = "";
	if (
		bytes.length >= 24 &&
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
		bytes.toString("ascii", 12, 16) === "IHDR"
	)
		detected = ".png";
	if (
		bytes.length >= 4 &&
		bytes[0] === 255 &&
		bytes[1] === 216 &&
		bytes[2] === 255 &&
		bytes.at(-2) === 255 &&
		bytes.at(-1) === 217
	)
		detected = ".jpg";
	if (
		bytes.length >= 13 &&
		/^(?:GIF87a|GIF89a)$/u.test(bytes.toString("ascii", 0, 6))
	)
		detected = ".gif";
	if (
		bytes.length >= 16 &&
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP" &&
		bytes.readUInt32LE(4) === bytes.length - 8
	)
		detected = ".webp";
	if (bytes.length >= 24 && bytes.toString("ascii", 4, 8) === "ftyp") {
		const boxSize = bytes.readUInt32BE(0);
		if (boxSize >= 24 && boxSize <= bytes.length) {
			const brands = [bytes.toString("ascii", 8, 12)];
			for (let offset = 16; offset + 4 <= boxSize; offset += 4)
				brands.push(bytes.toString("ascii", offset, offset + 4));
			if (brands.includes("avif") || brands.includes("avis"))
				detected = ".avif";
		}
	}
	if (
		!detected ||
		(extension !== detected && !(detected === ".jpg" && extension === ".jpeg"))
	)
		throw fail("The image signature does not match its filename.");
	return { extension: detected, bytes };
}

/** A local-only store. Callers must protect HTTP access; no file code is executed. */
export function createStore(root) {
	if (typeof root !== "string" || !isAbsolute(root))
		throw fail("An absolute repository root is required.");
	const directory = resolve(root);
	const locks = new Map();

	async function rootPath() {
		const stat = await fs.lstat(directory);
		if (stat.isSymbolicLink() || !stat.isDirectory())
			throw fail("The repository root must be a real directory.");
		return fs.realpath(directory);
	}

	function inside(realRoot, full) {
		const child = relative(realRoot, full);
		if (
			isAbsolute(child) ||
			child === ".." ||
			child.startsWith(`..${win32.sep}`) ||
			child.startsWith("../")
		)
			throw fail("The path resolves outside the repository.");
	}

	async function inspect(
		path,
		{ internal = false, createParents = false } = {},
	) {
		const parts = segments(path, internal);
		const realRoot = await rootPath();
		let full = directory;
		for (let index = 0; index < parts.length; index += 1) {
			full = resolve(full, parts[index]);
			let stat;
			try {
				stat = await fs.lstat(full);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				if (index < parts.length - 1 && createParents) {
					try {
						await fs.mkdir(full);
					} catch (mkdirError) {
						if (mkdirError.code !== "EEXIST") throw mkdirError;
					}
					stat = await fs.lstat(full);
				} else
					return {
						full: resolve(directory, ...parts),
						exists: false,
						stat: null,
					};
			}
			if (stat.isSymbolicLink())
				throw fail("Symbolic links and junctions are not supported.");
			inside(realRoot, await fs.realpath(full));
			if (index < parts.length - 1 && !stat.isDirectory())
				throw fail("A parent path is not a directory.");
			if (index === parts.length - 1) return { full, exists: true, stat };
		}
		throw fail("Invalid path.");
	}

	async function readBytes(path, limit = MAX_TEXT, internal = false) {
		const entry = await inspect(path, { internal });
		if (!entry.exists) throw fail("File not found.", 404);
		if (!entry.stat.isFile() || entry.stat.nlink > 1)
			throw fail("Only regular, unlinked files are supported.");
		const handle = await fs.open(
			entry.full,
			constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
		);
		try {
			const stat = await handle.stat();
			if (
				!stat.isFile() ||
				stat.nlink > 1 ||
				stat.ino !== entry.stat.ino ||
				stat.dev !== entry.stat.dev
			)
				throw fail("The file changed while opening it.", 409);
			if (stat.size > limit) throw fail("File exceeds the allowed size.", 413);
			const bytes = await handle.readFile();
			if (bytes.length > limit)
				throw fail("File exceeds the allowed size.", 413);
			return bytes;
		} finally {
			await handle.close();
		}
	}

	async function locked(path, operation) {
		const key = process.platform === "win32" ? path.toLowerCase() : path;
		const previous = locks.get(key) || Promise.resolve();
		const running = previous.catch(() => {}).then(operation);
		locks.set(key, running);
		try {
			return await running;
		} finally {
			if (locks.get(key) === running) locks.delete(key);
		}
	}

	async function snapshot(path, bytes, operation) {
		const id = randomUUID();
		const prefix = `.local-manager/backups/${id}`;
		const metadata = {
			id,
			path,
			operation,
			createdAt: new Date().toISOString(),
			existed: bytes !== null,
			size: bytes?.length || 0,
			hash: bytes === null ? null : digest(bytes),
		};
		const target = await inspect(`${prefix}/content`, {
			internal: true,
			createParents: true,
		});
		await fs.writeFile(target.full, bytes || Buffer.alloc(0), {
			flag: "wx",
			mode: 0o600,
		});
		const manifest = await inspect(`${prefix}/metadata.json`, {
			internal: true,
		});
		await fs.writeFile(
			manifest.full,
			`${JSON.stringify(metadata, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		return id;
	}

	async function current(path) {
		const entry = await inspect(path);
		return entry.exists ? readBytes(path) : null;
	}

	async function requireVersion(path, hash, create) {
		const bytes = await current(path);
		if (create) {
			if (bytes !== null) throw fail("This file already exists.", 409);
		} else {
			if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))
				throw fail("The current file hash is required.", 409);
			if (bytes === null) throw fail("File not found.", 404);
			if (digest(bytes) !== hash)
				throw fail("The file has changed. Reload it before saving.", 409);
		}
		return bytes;
	}

	async function atomicWrite(
		path,
		bytes,
		{ internal = false, create = false, expectedHash } = {},
	) {
		const entry = await inspect(path, { internal, createParents: true });
		const temp = resolve(dirname(entry.full), `.manager-${randomUUID()}.tmp`);
		let handle;
		try {
			handle = await fs.open(temp, "wx", entry.stat?.mode & 0o777 || 0o600);
			await handle.writeFile(bytes);
			await handle.sync();
			await handle.close();
			handle = null;
			await inspect(path, { internal });
			if (expectedHash !== undefined) {
				const latest = await current(path);
				if ((latest === null ? null : digest(latest)) !== expectedHash)
					throw fail("The file changed before it could be saved.", 409);
			}
			if (create) {
				// link is an atomic no-replace publish; rename lacks NOREPLACE in Node.
				try {
					await fs.link(temp, entry.full);
				} catch (error) {
					if (error.code === "EEXIST")
						throw fail("This file already exists.", 409);
					throw error;
				}
				await fs.unlink(temp);
			} else await fs.rename(temp, entry.full);
		} finally {
			if (handle) await handle.close();
			await fs.unlink(temp).catch((error) => {
				if (error.code !== "ENOENT") throw error;
			});
		}
	}

	async function walk(path, visit) {
		const entry = await inspect(path);
		if (!entry.exists) return;
		if (!entry.stat.isDirectory()) return;
		for (const item of await fs.readdir(entry.full, { withFileTypes: true })) {
			if (
				item.name.startsWith(".") ||
				FORBIDDEN.has(item.name.toLowerCase()) ||
				(path === "public" && item.name.toLowerCase() === "admin") ||
				item.isSymbolicLink()
			)
				continue;
			const child = `${path}/${item.name}`;
			if (item.isDirectory()) await walk(child, visit);
			else if (item.isFile()) await visit(child);
		}
	}

	async function catalog() {
		const files = [];
		for (const path of SCAN_ROOTS)
			await walk(path, async (child) => {
				if (!editable(child)) return;
				const { stat } = await inspect(child);
				if (!stat?.isFile() || stat.nlink > 1 || stat.size > MAX_TEXT) return;
				files.push({
					path: child,
					group: groupFor(child),
					label: basename(child),
					size: stat.size,
					modifiedAt: stat.mtime.toISOString(),
				});
			});
		return { files: files.sort((a, b) => a.path.localeCompare(b.path, "en")) };
	}

	async function read(path) {
		requireEditable(path);
		const bytes = await readBytes(path);
		return { path, content: decodeText(bytes), hash: digest(bytes) };
	}

	async function write(input = {}) {
		if (!input || typeof input !== "object" || Array.isArray(input))
			throw fail("A file update object is required.");
		const { path, content, hash, create = false } = input;
		requireEditable(path);
		if (typeof create !== "boolean") throw fail("Create must be a boolean.");
		const bytes = validateContent(path, content);
		return locked(path, async () => {
			const before = await requireVersion(path, hash, create);
			const backupId = await snapshot(
				path,
				before,
				create ? "create" : "write",
			);
			await atomicWrite(path, bytes, {
				create,
				expectedHash: before === null ? null : digest(before),
			});
			return { path, content, hash: digest(bytes), backupId };
		});
	}

	async function remove(input = {}) {
		if (!input || typeof input !== "object" || Array.isArray(input))
			throw fail("A file removal object is required.");
		const { path, hash } = input;
		requireEditable(path);
		return locked(path, async () => {
			const before = await requireVersion(path, hash, false);
			const backupId = await snapshot(path, before, "remove");
			await requireVersion(path, hash, false);
			const target = await inspect(path);
			await fs.unlink(target.full);
			return { backupId };
		});
	}

	async function history() {
		const target = await inspect(".local-manager/backups", { internal: true });
		if (!target.exists) return { backups: [] };
		const backups = [];
		for (const item of await fs.readdir(target.full, { withFileTypes: true })) {
			if (!item.isDirectory() || item.isSymbolicLink() || !UUID.test(item.name))
				continue;
			try {
				const bytes = await readBytes(
					`.local-manager/backups/${item.name}/metadata.json`,
					8192,
					true,
				);
				const metadata = JSON.parse(bytes.toString("utf8"));
				if (metadata.id !== item.name || !editable(metadata.path)) continue;
				backups.push(metadata);
			} catch (error) {
				if (error.status !== 404 && error.code !== "ENOENT") throw error;
			}
		}
		return {
			backups: backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		};
	}

	async function restore(backupId) {
		if (typeof backupId !== "string" || !UUID.test(backupId))
			throw fail("Invalid backup identifier.");
		const prefix = `.local-manager/backups/${backupId}`;
		const metadata = JSON.parse(
			(await readBytes(`${prefix}/metadata.json`, 8192, true)).toString("utf8"),
		);
		requireEditable(metadata.path);
		if (metadata.id !== backupId || typeof metadata.existed !== "boolean")
			throw fail("Invalid backup metadata.");
		const bytes = await readBytes(`${prefix}/content`, MAX_TEXT, true);
		if (
			(metadata.existed && digest(bytes) !== metadata.hash) ||
			bytes.length !== metadata.size
		)
			throw fail("Backup content does not match its metadata.");
		if (metadata.existed) validateContent(metadata.path, decodeText(bytes));
		return locked(metadata.path, async () => {
			const before = await current(metadata.path);
			const replacementBackupId = await snapshot(
				metadata.path,
				before,
				"restore",
			);
			if (!metadata.existed) {
				if (before !== null) {
					await requireVersion(metadata.path, digest(before), false);
					await fs.unlink((await inspect(metadata.path)).full);
				}
				return {
					path: metadata.path,
					removed: true,
					backupId: replacementBackupId,
				};
			}
			await atomicWrite(metadata.path, bytes, {
				create: before === null,
				expectedHash: before === null ? null : digest(before),
			});
			return {
				path: metadata.path,
				content: decodeText(bytes),
				hash: digest(bytes),
				backupId: replacementBackupId,
			};
		});
	}

	async function upload(input = {}) {
		if (!input || typeof input !== "object" || Array.isArray(input))
			throw fail("An image upload object is required.");
		const { name, data } = input;
		const { extension, bytes } = imageExtension(name, data);
		const path = `public/images/uploads/${randomUUID()}${extension}`;
		await atomicWrite(path, bytes, { create: true });
		return { path, reference: mediaReference(path) };
	}

	async function listMedia() {
		const files = [];
		for (const directory of ["public", "src/assets/images"])
			await walk(directory, async (path) => {
				if (!RASTER.test(path)) return;
				const { stat } = await inspect(path);
				if (stat?.isFile() && stat.nlink === 1)
					files.push({
						path,
						reference: mediaReference(path),
						size: stat.size,
					});
			});
		return { files: files.sort((a, b) => a.path.localeCompare(b.path, "en")) };
	}

	async function resolveMedia(input, options = {}) {
		return resolveMediaReference(input, {
			...options,
			root: directory,
			files: (await listMedia()).files,
		});
	}

	async function importMedia(input, options = {}) {
		const resolved = await resolveMedia(
			{ ...input, reference: input?.reference ?? input?.path },
			options,
		);
		if (resolved.kind !== "local" || resolved.path.startsWith("public/"))
			return { ...resolved, imported: false };
		const bytes = await readBytes(resolved.path, MAX_IMAGE);
		const { extension } = imageExtension(
			basename(resolved.path),
			bytes.toString("base64"),
		);
		const hash = digest(bytes);
		const destination = `public/images/uploads/${hash}${extension}`;
		return locked(destination, async () => {
			const existing = await inspect(destination);
			if (existing.exists) {
				if (digest(await readBytes(destination, MAX_IMAGE)) !== hash)
					throw fail("已导入图片的内容发生变化，请先核对文件。", 409);
			} else await atomicWrite(destination, bytes, { create: true });
			const reference = mediaReference(destination);
			return {
				kind: "local",
				path: destination,
				reference,
				markdownReference: reference,
				imported: true,
				created: !existing.exists,
			};
		});
	}

	return {
		catalog,
		read,
		write,
		remove,
		upload,
		listMedia,
		resolveMedia,
		importMedia,
		history,
		restore,
	};
}
