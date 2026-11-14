import ts from "typescript";

const fail = (message, status = 400) =>
	Object.assign(new Error(message), { status });

const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

const field = (key, label, type, group, options = {}) => ({
	key,
	label,
	type,
	group,
	width: "half",
	...options,
});

export const COLLECTION_DEFS = {
	anime: {
		kind: "anime",
		label: "番剧",
		itemLabel: "作品",
		path: "src/data/anime.ts",
		exportName: "animeData",
		statuses: [
			{ value: "watching", label: "在看" },
			{ value: "completed", label: "看过" },
			{ value: "planned", label: "想看" },
			{ value: "onHold", label: "搁置" },
			{ value: "dropped", label: "弃番" },
		],
		fields: [
			field("title", "作品名", "string", "基本信息", {
				required: true,
				placeholder: "例如：葬送的芙莉莲",
			}),
			field("year", "放送年份", "string", "基本信息", {
				required: true,
				placeholder: "2023",
			}),
			field("studio", "制作公司", "string", "基本信息", {
				placeholder: "Madhouse",
			}),
			field("genres", "题材标签", "list", "基本信息", {
				placeholder: "用逗号分隔：Fantasy, Adventure",
			}),
			field("status", "观看状态", "status", "状态与评分"),
			field("rating", "个人评分", "rating", "状态与评分", {
				help: "0–10，0 表示未评分",
			}),
			field("progress", "追番进度", "pair", "状态与评分", {
				subfields: [
					{ key: "watched", label: "已看", type: "number", placeholder: "12" },
					{ key: "total", label: "总集数", type: "number", placeholder: "28" },
				],
			}),
			field("period", "观看时间", "pair", "状态与评分", {
				subfields: [
					{ key: "start", label: "开始", type: "string", placeholder: "2023-09" },
					{ key: "end", label: "结束", type: "string", placeholder: "2024-03" },
				],
			}),
			field("cover", "封面图片", "image", "图片与链接", {
				width: "full",
				help: "选择本地图片、已有素材或填写路径；留空时站点显示渐变占位。",
			}),
			field("link", "条目外链", "url", "图片与链接", {
				width: "full",
				placeholder: "https://movie.douban.com/subject/…",
			}),
			field("description", "一句话感想", "text", "简介与备注", {
				width: "full",
			}),
			field("__comment", "分组注释", "comment", "简介与备注", {
				width: "full",
				help: "保存为该条目上方的 // 注释，可用来给列表分段；不会显示在站点上。",
			}),
		],
	},
	books: {
		kind: "books",
		label: "书单",
		itemLabel: "书",
		path: "src/data/books.ts",
		exportName: "booksData",
		statuses: [
			{ value: "reading", label: "在读" },
			{ value: "planned", label: "想读" },
			{ value: "completed", label: "读过" },
			{ value: "onHold", label: "搁置" },
		],
		fields: [
			field("title", "书名", "string", "基本信息", {
				required: true,
				placeholder: "例如：思考，快与慢",
			}),
			field("originalTitle", "原名 / 副标题", "string", "基本信息", {
				placeholder: "Thinking, Fast and Slow",
			}),
			field("author", "作者", "string", "基本信息"),
			field("slug", "条目标识", "string", "基本信息", {
				help: "用于封面文件名与锚点，留空时由书名自动生成。",
			}),
			field("isbn", "ISBN", "string", "基本信息", {
				placeholder: "9787508633558",
			}),
			field("yearPublished", "出版年份", "string", "基本信息", {
				placeholder: "2012",
			}),
			field("status", "阅读状态", "status", "状态与评分"),
			field("rating", "个人评分", "rating", "状态与评分", {
				help: "0–10，0 表示未评分",
			}),
			field("progress", "阅读进度", "number", "状态与评分", {
				help: "0–100，仅在读状态显示进度条",
			}),
			field("featured", "置顶显示", "boolean", "状态与评分"),
			field("genres", "题材标签", "list", "状态与评分", {
				placeholder: "用逗号分隔：Psychology, Decision",
			}),
			field("cover", "封面图片", "image", "图片与链接", {
				width: "full",
				help: "选择本地图片、已有素材或填写路径；留空时站点显示渐变占位。",
			}),
			field("douban", "豆瓣条目 ID", "string", "图片与链接", {
				placeholder: "例如：10785583",
			}),
			field("link", "条目外链", "url", "图片与链接", {
				width: "full",
				help: "留空时站点会用豆瓣 ID 自动生成链接。",
				placeholder: "https://book.douban.com/subject/…",
			}),
			field("coverId", "Open Library 封面 ID", "string", "图片与链接", {
				advanced: true,
			}),
			field("year", "阅读年份", "string", "简介与备注", {
				advanced: true,
			}),
			field("description", "一句话感想", "text", "简介与备注", {
				width: "full",
			}),
			field("__comment", "分组注释", "comment", "简介与备注", {
				width: "full",
				help: "保存为该条目上方的 // 注释，可用来给列表分段；不会显示在站点上。",
			}),
		],
	},
};

export function collectionKindFor(path) {
	for (const def of Object.values(COLLECTION_DEFS))
		if (def.path === path) return def.kind;
	return null;
}

function createSource(def, content) {
	const source = ts.createSourceFile(
		def.path,
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (source.parseDiagnostics.length)
		throw fail("数据文件语法有误，请先在「源文件」模式修复。");
	return source;
}

function findArray(source, exportName) {
	let found = null;
	function visit(node) {
		if (found) return;
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === exportName
		) {
			let value = node.initializer;
			while (
				value &&
				(ts.isAsExpression(value) || ts.isSatisfiesExpression(value))
			)
				value = value.expression;
			if (value && ts.isArrayLiteralExpression(value)) found = value;
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return found;
}

function lineOf(source, position) {
	return source.getLineAndCharacterOfPosition(position).line + 1;
}

function literalValue(node, source, text) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	)
		return -Number(node.operand.text);
	if (ts.isArrayLiteralExpression(node))
		return node.elements.map((element) =>
			literalValue(element, source, text),
		);
	if (ts.isObjectLiteralExpression(node))
		return readObject(node, source, text);
	throw fail(
		`第 ${lineOf(source, node.getStart(source))} 行含可视化编辑暂不支持的表达式；请切到「源文件」模式修改。`,
	);
}

function readObject(node, source, text) {
	const output = {};
	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property))
			throw fail("条目中只能使用普通属性，暂不支持展开或方法。");
		const key =
			ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
				? property.name.text
				: null;
		if (!key || RESERVED.has(key)) throw fail("条目包含无效字段名。");
		output[key] = literalValue(property.initializer, source, text);
	}
	return output;
}

function commentLines(text, from, to) {
	const raw = text.slice(from, to);
	if (/^\s*\/\*/.test(raw))
		return raw
			.replace(/^\s*\/\*/, "")
			.replace(/\*\/\s*$/, "")
			.split(/\r?\n/)
			.map((line) => line.replace(/^\s*\*\s?/, "").trim())
			.filter(Boolean);
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("//"))
		.map((line) => line.replace(/^\/\/\s?/, "").trim())
		.filter(Boolean);
}

function leadingComments(text, element, array, source) {
	const ranges =
		ts.getLeadingCommentRanges(text, element.getFullStart()) || [];
	return ranges
		.filter(
			(range) =>
				range.pos > array.getStart(source) &&
				range.end <= element.getStart(source),
		)
		.flatMap((range) => commentLines(text, range.pos, range.end));
}

function trailingComments(text, array, source) {
	const from = array.elements.length
		? array.elements[array.elements.length - 1].end
		: array.getStart(source) + 1;
	return commentLines(text, from, array.getEnd() - 1);
}

/** Read every item plus the comments attached to it, without touching other code. */
export function readCollection(content, kind) {
	const def = COLLECTION_DEFS[kind];
	if (!def) throw fail("未知的条目类型。", 404);
	const source = createSource(def, content);
	const array = findArray(source, def.exportName);
	if (!array)
		throw fail(`未找到 ${def.exportName} 数组，请用「源文件」模式检查。`);
	const text = source.getFullText();
	const items = [];
	const comments = [];
	for (const element of array.elements) {
		if (!ts.isObjectLiteralExpression(element))
			throw fail("条目必须是对象字面量，请先用「源文件」模式整理。");
		items.push(readObject(element, source, text));
		comments.push(leadingComments(text, element, array, source));
	}
	return {
		items,
		comments,
		tailComments: trailingComments(text, array, source),
	};
}

function safeString(value, label) {
	if (typeof value !== "string") throw fail(`${label} 必须是文字。`);
	if (value.length > 4000) throw fail(`${label} 过长。`);
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
		throw fail(`${label} 含不可见控制字符。`);
	return value;
}

function safeValue(value, label, depth = 0) {
	if (depth > 6) throw fail(`${label} 嵌套过深。`);
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw fail(`${label} 不是有效数字。`);
		return value;
	}
	if (typeof value === "string") return safeString(value, label);
	if (Array.isArray(value))
		return value.map((entry, index) =>
			safeValue(entry, `${label}[${index}]`, depth + 1),
		);
	if (value && typeof value === "object") {
		const output = {};
		for (const [key, entry] of Object.entries(value)) {
			if (RESERVED.has(key)) throw fail("条目包含无效字段名。");
			output[key] = safeValue(entry, `${label}.${key}`, depth + 1);
		}
		return output;
	}
	throw fail(`${label} 含无法保存的值。`);
}

function safeUrl(value, label) {
	if (value === "" || value === undefined) return;
	if (!/^https?:\/\/\S+$/i.test(value))
		throw fail(`${label} 需填写 http(s) 链接，或留空。`);
}

function safeCover(value) {
	if (value === "" || value === undefined) return;
	if (/^https?:\/\/\S+$/i.test(value)) return;
	if (!value.startsWith("/") || value.startsWith("//") || value.includes(".."))
		throw fail("封面图片需填写 /assets/… 或 /images/… 这类站内路径，或 http(s) 链接。");
}

function validateField(item, schema, statuses) {
	const value = item[schema.key];
	if (value === undefined) {
		if (schema.required) throw fail(`「${schema.label}」不能为空。`);
		return;
	}
	switch (schema.type) {
		case "string":
		case "text":
		case "url":
		case "image":
		case "comment":
			safeString(value, schema.label);
			break;
		case "number":
		case "rating":
			if (typeof value !== "number" || !Number.isFinite(value))
				throw fail(`「${schema.label}」必须是数字。`);
			break;
		case "boolean":
			if (typeof value !== "boolean")
				throw fail(`「${schema.label}」必须是是/否。`);
			break;
		case "status":
			if (!statuses.some((status) => status.value === value))
				throw fail(`「${schema.label}」取值不正确。`);
			break;
		case "list":
			if (
				!Array.isArray(value) ||
				!value.every((entry) => typeof entry === "string")
			)
				throw fail(`「${schema.label}」必须是文字列表。`);
			break;
		case "pair": {
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw fail(`「${schema.label}」格式不正确。`);
			for (const sub of schema.subfields) {
				const entry = value[sub.key];
				if (entry === undefined) continue;
				if (sub.type === "number") {
					if (typeof entry !== "number" || !Number.isFinite(entry))
						throw fail(`「${schema.label} · ${sub.label}」必须是数字。`);
				} else safeString(entry, `${schema.label} · ${sub.label}`);
			}
			break;
		}
		default:
			break;
	}
}

export function validateCollection(kind, payload) {
	const def = COLLECTION_DEFS[kind];
	if (!def) throw fail("未知的条目类型。", 404);
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		throw fail("提交内容格式不正确。");
	const { items, comments, tailComments } = payload;
	if (!Array.isArray(items) || items.length > 200)
		throw fail("条目列表不正确，或一次最多保存 200 条。");
	const checkLines = (list, label) => {
		if (list === undefined) return [];
		if (!Array.isArray(list)) throw fail(`${label} 格式不正确。`);
		return list.map((line) => {
			const text = safeString(line, label);
			if (text.length > 300 || /[\r\n]|\*\//.test(text))
				throw fail(`${label} 每行不超过 300 字且不能换行。`);
			return text;
		});
	};
	const checkComments = (list, label) => {
		if (list === undefined) return [];
		if (!Array.isArray(list)) throw fail(`${label} 格式不正确。`);
		return list.map((lines, index) =>
			checkLines(lines, `${label}[${index}]`),
		);
	};
	const safeComments = checkComments(comments, "分组注释");
	const safeTailLines = checkLines(tailComments, "末尾注释");
	const clean = items.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item))
			throw fail(`第 ${index + 1} 条不是有效条目。`);
		const result = {};
		for (const [key, value] of Object.entries(item)) {
			if (RESERVED.has(key) || key.startsWith("__"))
				throw fail(`第 ${index + 1} 条含无效字段名：${key}`);
			result[key] = safeValue(value, `第 ${index + 1} 条 · ${key}`);
		}
		for (const schema of def.fields)
			if (schema.key !== "__comment")
				validateField(result, schema, def.statuses);
		if (typeof result.title !== "string" || !result.title.trim())
			throw fail(`第 ${index + 1} 条还没有填写标题。`);
		if (
			typeof result.rating === "number" &&
			(result.rating < 0 || result.rating > 10)
		)
			throw fail(`第 ${index + 1} 条评分需在 0–10 之间。`);
		safeCover(result.cover);
		safeUrl(result.link, "条目外链");
		return result;
	});
	return {
		items: clean,
		comments: safeComments,
		tailComments: safeTailLines,
	};
}

function quote(value) {
	return (
		'"' +
		value
			.replaceAll("\\", "\\\\")
			.replaceAll('"', '\\"')
			.replaceAll("\r", "\\r")
			.replaceAll("\n", "\\n")
			.replaceAll("\t", "\\t")
			.replaceAll("\u2028", "\\u2028")
			.replaceAll("\u2029", "\\u2029") +
		'"'
	);
}

function propertyName(key) {
	return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatValue(value, depth = 2) {
	if (value === null) return "null";
	if (typeof value === "string") return quote(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (Array.isArray(value)) {
		if (!value.length) return "[]";
		if (
			value.every(
				(entry) =>
					entry === null ||
					["string", "number", "boolean"].includes(typeof entry),
			)
		)
			return "[" + value.map((entry) => formatValue(entry, depth)).join(", ") + "]";
		const pad = "\t".repeat(depth + 1);
		return (
			"[\n" +
			value
				.map(
					(entry) => pad + formatValue(entry, depth + 1) + ",",
				)
				.join("\n") +
			"\n" +
			"\t".repeat(depth) +
			"]"
		);
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).filter(
			([, entry]) => entry !== undefined,
		);
		if (!entries.length) return "{}";
		const inline = entries.every(
			([, entry]) =>
				entry === null ||
				["string", "number", "boolean"].includes(typeof entry),
		);
		if (inline)
			return (
				"{ " +
				entries
					.map(
						([key, entry]) =>
							propertyName(key) + ": " + formatValue(entry, depth),
					)
					.join(", ") +
				" }"
			);
		const pad = "\t".repeat(depth + 1);
		return (
			"{\n" +
			entries
				.map(
					([key, entry]) =>
						pad +
						propertyName(key) +
						": " +
						formatValue(entry, depth + 1) +
						",",
				)
				.join("\n") +
			"\n" +
			"\t".repeat(depth) +
			"}"
		);
	}
	throw fail("条目包含无法保存的值。");
}

/** Replace only the array literal; every other byte of the file is preserved. */
export function writeCollection(content, kind, payload) {
	const def = COLLECTION_DEFS[kind];
	if (!def) throw fail("未知的条目类型。", 404);
	const clean = validateCollection(kind, payload);
	const source = createSource(def, content);
	const array = findArray(source, def.exportName);
	if (!array) throw fail(`未找到 ${def.exportName} 数组。`);
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = ["["];
	clean.items.forEach((item, index) => {
		for (const comment of clean.comments[index] || [])
			lines.push("\t// " + comment);
		lines.push("\t{");
		for (const [key, value] of Object.entries(item)) {
			if (value === undefined) continue;
			lines.push(
				"\t\t" + propertyName(key) + ": " + formatValue(value) + ",",
			);
		}
		lines.push("\t},");
	});
	for (const comment of clean.tailComments) lines.push("\t// " + comment);
	lines.push("]");
	const replacement = lines.join(eol);
	return (
		content.slice(0, array.getStart(source)) +
		replacement +
		content.slice(array.getEnd())
	);
}
