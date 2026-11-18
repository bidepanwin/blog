import assert from "node:assert/strict";
import { test } from "node:test";
import { rehypeExternalLinks } from "../../../src/plugins/rehype-external-links.mjs";
import {
	isExternalHref,
	mergeExternalRel,
	siteHosts,
} from "../../../src/utils/external-link.mjs";
import { siteMarkdownProcessor } from "../../../src/utils/markdown-processor.mjs";

const SITE = "https://bidepanwin.github.io/blog/";
const hosts = siteHosts(SITE);
const renderer = await siteMarkdownProcessor.createRenderer({});

const render = async (markdown) =>
	String((await renderer.render(markdown)).code);

const anchors = (html) =>
	[...html.matchAll(/<a\b([^>]*)>/gi)].map((match) => match[1]);

const link = (href, extra = {}) => ({
	type: "element",
	tagName: "a",
	properties: { href, ...extra },
	children: [],
});

const transform = (nodes) => {
	const tree = { type: "root", children: nodes };
	rehypeExternalLinks({ site: SITE })(tree);
	return tree.children;
};

test("判定规则：仅 http(s) 且 host 不属于本站的链接算外部", () => {
	assert.equal(isExternalHref("https://github.com/a", hosts), true);
	assert.equal(isExternalHref("http://example.com:8080/", hosts), true);
	assert.equal(isExternalHref("//github.com/a", hosts), true);
	assert.equal(isExternalHref(SITE, hosts), false);
	assert.equal(isExternalHref("/blog/about/", hosts), false);
	assert.equal(isExternalHref("#section", hosts), false);
	assert.equal(isExternalHref("mailto:hi@example.com", hosts), false);
	assert.equal(isExternalHref("tel:+8610000000000", hosts), false);
	assert.equal(isExternalHref("javascript:void(0)", hosts), false);
	assert.equal(isExternalHref("https://[invalid", hosts), false);
	assert.equal(isExternalHref(null, hosts), false);
	assert.deepEqual(mergeExternalRel(["me", "nofollow"]), [
		"me",
		"nofollow",
		"noopener",
		"noreferrer",
	]);
	assert.deepEqual(mergeExternalRel("noopener"), ["noopener", "noreferrer"]);
});

test("插件为外部链接补充 target 与 rel，保留已有 rel 语义", () => {
	const [external, withRel] = transform([
		link("https://github.com/example/repo"),
		link("https://example.com/", { rel: ["me", "nofollow"] }),
	]);
	assert.equal(external.properties.target, "_blank");
	assert.deepEqual(external.properties.rel, ["noopener", "noreferrer"]);
	assert.equal(withRel.properties.target, "_blank");
	assert.deepEqual(withRel.properties.rel, [
		"me",
		"nofollow",
		"noopener",
		"noreferrer",
	]);
});

test("插件跳过站内地址、显式 target、download 与非 a 元素", () => {
	const [internal, relative, anchor, mailto, explicit, download, div] =
		transform([
			link(SITE),
			link("/blog/about/"),
			link("#heading"),
			link("mailto:hi@example.com"),
			link("https://example.com/", { target: "_self" }),
			link("https://example.com/file.zip", { download: true }),
			{
				type: "element",
				tagName: "div",
				properties: { href: "https://example.com/" },
				children: [],
			},
		]);
	for (const node of [internal, relative, anchor, mailto]) {
		assert.equal(node.properties.target, undefined);
		assert.equal(node.properties.rel, undefined);
	}
	assert.equal(explicit.properties.target, "_self");
	assert.equal(explicit.properties.rel, undefined);
	assert.equal(download.properties.target, undefined);
	assert.equal(div.properties.target, undefined);
});

test("插件递归处理组件生成的嵌套链接", () => {
	const tree = {
		type: "root",
		children: [
			{
				type: "element",
				tagName: "div",
				properties: {},
				children: [link("https://example.com/nested")],
			},
		],
	};
	rehypeExternalLinks({ site: SITE })(tree);
	assert.equal(tree.children[0].children[0].properties.target, "_blank");
});

test("Markdown 渲染：外链新窗口、站内与锚点保持当前窗口", async () => {
	const html = await render(
		"外链 [GitHub](https://github.com/example/repo)、同站 [关于](https://bidepanwin.github.io/blog/about/)、站内 [相对](/about/)、[锚点](#top)。",
	);
	const found = anchors(html);
	assert.equal(found.length, 4);
	assert.match(found[0], /target="_blank"/u);
	assert.match(found[0], /rel="noopener noreferrer"/u);
	for (const attrs of found.slice(1)) assert.doesNotMatch(attrs, /target=/u);
	assert.match(html, /href="\/blog\/about\/"/u, "base path 仍生效");
});

test("Markdown 渲染：GitHub 卡片组件输出的链接同样在新窗口打开", async () => {
	const html = await render('::github{repo="LyraVoid/Shirone"}');
	const external = anchors(html).filter((attrs) => /github\.com/u.test(attrs));
	assert.ok(external.length > 0, "组件应至少输出一个 GitHub 链接");
	for (const attrs of external) {
		assert.match(attrs, /target="_blank"/u);
		assert.match(attrs, /rel="noopener noreferrer"/u);
	}
});
