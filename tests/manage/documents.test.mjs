import assert from "node:assert/strict";
import test from "node:test";
import {
	newDocument,
	readSettings,
	splitDocument,
	updateDocument,
	updateSettings,
} from "../../scripts/manage/documents.mjs";

test("document edits retain unknown metadata and YAML comments", () => {
	const original =
		"---\n# Keep the editorial note\ntitle: Old title # displayed heading\npublished: 2026-11-14\ncustom:\n  nested: preserve me\n  count: 3\ntags: [original]\n---\n\nOld body\n";
	const result = updateDocument(
		original,
		{ title: "A new: title", tags: ["new", "中文"] },
		"New **body**\n",
	);
	const { frontmatter, body } = splitDocument(result);
	assert.equal(frontmatter.title, "A new: title");
	assert.deepEqual(frontmatter.custom, { nested: "preserve me", count: 3 });
	assert.equal(frontmatter.published, "2026-11-14");
	assert.deepEqual(frontmatter.tags, ["new", "中文"]);
	assert.equal(body, "New **body**\n");
	assert.match(result, /# Keep the editorial note/);
	assert.match(result, /# displayed heading/);
});

test("document edits preserve BOM and CRLF without introducing mixed newlines", () => {
	const original =
		"\uFEFF---\r\ntitle: Original\r\ncustom: true\r\n---\r\n\r\nBody\r\n";
	const result = updateDocument(original, { title: "更新" }, "One\nTwo\n");
	assert.ok(result.startsWith("\uFEFF---\r\n"));
	assert.equal(result.replaceAll("\r\n", "").includes("\n"), false);
	assert.equal(splitDocument(result).frontmatter.custom, true);
	assert.equal(splitDocument(result).body, "One\r\nTwo\r\n");
});

test("plain Markdown remains editable and invalid YAML or field input is rejected", () => {
	assert.deepEqual(splitDocument("Plain Markdown\n").frontmatter, {});
	assert.equal(splitDocument("Plain Markdown\n").body, "Plain Markdown\n");
	assert.throws(() => splitDocument("---\ntitle: [unclosed\n---\n"));
	assert.throws(() => splitDocument("---\n- not an object\n---\n"));
	assert.throws(() => updateDocument("Text", [], "body"));
	assert.throws(() => updateDocument("Text", {}, null));
	assert.throws(() =>
		updateDocument(
			"Text",
			JSON.parse('{"__proto__":{"polluted":true}}'),
			"body",
		),
	);
	assert.equal({}.polluted, undefined);
});

const settingsSource = `import type { SiteConfig } from "./types";
globalThis.__managerDocumentTestExecuted = true;
export const siteConfig: SiteConfig = withUserConfig("site", {
  // Keep the deployment path.
  base: "/blog/",
  title: "Original", // Keep title comment.
  banner: { homeText: { title: 'Hero', typewriter: { enable: true, speed: 80 } } },
  list: ["first", "second"],
  adjustment: -2,
  computed: dangerousFunction(),
});
`;

test("settings are parsed without evaluating code and expose literal leaves only", () => {
	delete globalThis.__managerDocumentTestExecuted;
	const fields = readSettings(settingsSource);
	assert.equal(globalThis.__managerDocumentTestExecuted, undefined);
	assert.deepEqual(
		fields.find((field) => field.key === "banner.homeText.typewriter.enable"),
		{ key: "banner.homeText.typewriter.enable", value: true, type: "boolean" },
	);
	assert.deepEqual(
		fields.find((field) => field.key === "list"),
		{ key: "list", value: ["first", "second"], type: "string[]" },
	);
	assert.equal(fields.find((field) => field.key === "adjustment").value, -2);
	assert.equal(
		fields.some((field) => field.key === "computed"),
		false,
	);
});

test("settings edits replace selected AST leaves while retaining source and comments", () => {
	const result = updateSettings(settingsSource, {
		title: "新标题",
		"banner.homeText.typewriter.speed": 55,
		list: ["中文"],
	});
	assert.match(result, /title: "新标题", \/\/ Keep title comment\./);
	assert.match(result, /\/\/ Keep the deployment path\./);
	assert.match(result, /base: "\/blog\/"/);
	assert.match(result, /title: 'Hero'/);
	assert.match(result, /computed: dangerousFunction\(\)/);
	assert.ok(
		result.includes("globalThis.__managerDocumentTestExecuted = true;"),
	);
	const fields = readSettings(result);
	assert.equal(
		fields.find((field) => field.key === "banner.homeText.typewriter.speed")
			.value,
		55,
	);
	assert.deepEqual(fields.find((field) => field.key === "list").value, [
		"中文",
	]);
	assert.equal(globalThis.__managerDocumentTestExecuted, undefined);
});

test("settings reject wrong types, computed or unknown fields, and invalid source", () => {
	for (const values of [
		{ title: 123 },
		{ "banner.homeText.typewriter.enable": "true" },
		{ "banner.homeText.typewriter.speed": Number.POSITIVE_INFINITY },
		{ list: [1] },
		{ list: null },
		{ missing: true },
		{ computed: "overwrite expression" },
	]) {
		assert.throws(
			() => updateSettings(settingsSource, values),
			JSON.stringify(values),
		);
	}
	assert.throws(() => readSettings("export const siteConfig = { broken: "));
});

test("new documents have safe paths and collection-specific frontmatter", () => {
	const expectedDay = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
	for (const collection of [
		"posts",
		"moments",
		"thinking",
		"reports",
		"series",
		"spec",
	]) {
		const document = newDocument({
			collection,
			slug: `new-${collection}`,
			title: "  测试：新内容  ",
		});
		assert.equal(
			document.path,
			`src/content/${collection}/new-${collection}.md`,
		);
		const { frontmatter } = splitDocument(document.content);
		if (!["series", "spec"].includes(collection))
			assert.equal(frontmatter.published, expectedDay);
		if (collection !== "moments")
			assert.equal(frontmatter.title, "测试：新内容");
		if (["posts", "moments", "reports"].includes(collection))
			assert.equal(frontmatter.draft, true);
		if (collection === "series") assert.equal(frontmatter.status, "ongoing");
		if (collection === "thinking")
			assert.deepEqual(
				[frontmatter.school, frontmatter.voice, frontmatter.source],
				["", "", ""],
			);
		if (collection === "posts")
			assert.deepEqual(
				[frontmatter.category, frontmatter.image, frontmatter.pinned],
				["", "", false],
			);
	}
});

test("new document input rejects traversal, invalid names, collections and titles", () => {
	const valid = { collection: "posts", slug: "safe-name", title: "Title" };
	for (const slug of [
		"../escape",
		"x/y",
		"x\\y",
		"Name",
		"a.md",
		"",
		"a".repeat(81),
	])
		assert.throws(() => newDocument({ ...valid, slug }));
	for (const collection of ["../config", "unknown", "", null])
		assert.throws(() => newDocument({ ...valid, collection }));
	for (const title of ["", "  ", "x".repeat(201), null])
		assert.throws(() => newDocument({ ...valid, title }));
});
