import ts from "typescript";
import { parseDocument, stringify } from "yaml";

const fail = (message, status = 400) =>
	Object.assign(new Error(message), { status });

export function splitDocument(content) {
	const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	const yaml = parseDocument(match?.[1] || "");
	if (yaml.errors.length) throw fail("文章的 YAML 元数据有语法错误。");
	const frontmatter = yaml.toJS() || {};
	if (typeof frontmatter !== "object" || Array.isArray(frontmatter))
		throw fail("文章元数据必须是对象。");
	return {
		frontmatter,
		body: match
			? content.slice(match[0].length).replace(/^\r?\n/, "")
			: content,
		yaml,
	};
}

export function updateDocument(content, fields, body) {
	if (
		!fields ||
		typeof fields !== "object" ||
		Array.isArray(fields) ||
		typeof body !== "string"
	)
		throw fail("文章内容不完整。");
	const { yaml } = splitDocument(content);
	for (const [key, value] of Object.entries(fields)) {
		if (["__proto__", "prototype", "constructor"].includes(key))
			throw fail("无效字段。");
		yaml.set(key, value);
	}
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const output = `---\n${String(yaml)}---\n\n${body.replace(/\r\n/g, "\n")}`;
	return (
		(content.startsWith("\uFEFF") ? "\uFEFF" : "") + output.replace(/\n/g, eol)
	);
}

export function newDocument(
	{ collection, slug, title },
	timeZone = "Asia/Shanghai",
) {
	if (
		!["posts", "moments", "thinking", "reports", "series", "spec"].includes(
			collection,
		)
	)
		throw fail("请选择有效的内容栏目。");
	if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))
		throw fail("文件名请使用小写英文字母、数字和连字符（最多 80 位）。");
	if (typeof title !== "string" || !title.trim() || title.length > 200)
		throw fail("请填写不超过 200 字的标题。");
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		})
			.formatToParts(new Date())
			.map((p) => [p.type, p.value]),
	);
	const date = `${parts.year}-${parts.month}-${parts.day}`;
	const metadata =
		collection === "series"
			? { title: title.trim(), status: "ongoing", defaultCategory: "" }
			: collection === "spec"
				? { title: title.trim() }
				: collection === "moments"
					? { published: date, tags: [], draft: true }
					: {
							title: title.trim(),
							published: date,
							description: "",
							tags: [],
							...(collection === "posts"
								? { category: "", image: "", pinned: false }
								: {}),
							...(collection === "thinking"
								? { school: "", voice: "", source: "" }
								: { draft: true }),
						};
	return {
		path: `src/content/${collection}/${slug}.md`,
		content: `---\n${stringify(metadata)}---\n\n${collection === "moments" ? "" : `## ${title.trim()}\n\n`}`,
	};
}

function objectLiteral(source) {
	let object;
	function visit(node) {
		if (object) return;
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			/Config$/.test(node.name.text)
		) {
			const value = node.initializer;
			if (
				value &&
				ts.isCallExpression(value) &&
				ts.isIdentifier(value.expression) &&
				value.expression.text === "withUserConfig" &&
				value.arguments[1] &&
				ts.isObjectLiteralExpression(value.arguments[1])
			)
				object = value.arguments[1];
			else if (value && ts.isObjectLiteralExpression(value)) object = value;
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return object;
}

function literalValue(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (
		ts.isPrefixUnaryExpression(node) &&
		node.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(node.operand)
	)
		return -Number(node.operand.text);
	if (ts.isArrayLiteralExpression(node)) {
		const values = node.elements.map(literalValue);
		if (values.every((value) => typeof value === "string")) return values;
	}
	return undefined;
}

function configLeaves(content) {
	const source = ts.createSourceFile(
		"settings.ts",
		content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	if (source.parseDiagnostics.length)
		throw fail("配置文件语法有误，请先在源码模式修复。");
	const object = objectLiteral(source);
	const fields = [];
	function visit(current, prefix = "") {
		for (const property of current.properties) {
			if (!ts.isPropertyAssignment(property)) continue;
			if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
				continue;
			const key = prefix + property.name.text;
			if (ts.isObjectLiteralExpression(property.initializer))
				visit(property.initializer, `${key}.`);
			else {
				const value = literalValue(property.initializer);
				if (value !== undefined)
					fields.push({
						key,
						value,
						type: Array.isArray(value) ? "string[]" : typeof value,
						start: property.initializer.getStart(source),
						end: property.initializer.end,
					});
			}
		}
	}
	if (object) visit(object);
	return fields;
}

export function readSettings(content) {
	return configLeaves(content).map(({ start, end, ...field }) => field);
}

export function updateSettings(content, values) {
	if (!values || typeof values !== "object" || Array.isArray(values))
		throw fail("设置值无效。");
	const leaves = configLeaves(content);
	const changes = Object.entries(values).map(([key, value]) => {
		const field = leaves.find((field) => field.key === key);
		if (!field) throw fail(`此字段需在源码模式中编辑：${key}`);
		const type =
			Array.isArray(value) && value.every((item) => typeof item === "string")
				? "string[]"
				: typeof value;
		if (type !== field.type || (type === "number" && !Number.isFinite(value)))
			throw fail(`设置类型不正确：${key}`);
		return {
			...field,
			replacement: JSON.stringify(
				value,
				null,
				Array.isArray(value) ? "\t" : undefined,
			),
		};
	});
	let output = content;
	for (const change of changes.sort((a, b) => b.start - a.start))
		output =
			output.slice(0, change.start) +
			change.replacement +
			output.slice(change.end);
	return output;
}
