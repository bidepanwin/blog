/**
 * remark-wikilink：把 `[[目标]]` / `[[目标|显示文本]]` 渲染为站内双链。
 * 目标解析：thinking 优先，其次 posts（构建期扫描内容目录建立 slug→URL 映射）。
 * 断链渲染为 `.wikilink--broken`（虚线 + data 属性），用于后续 graph lint。
 */
import fs from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";

let slugMapCache = null;

function getSlugMap() {
	if (slugMapCache) return slugMapCache;
	const map = new Map();
	const roots = [
		["src/content/thinking", "/thinking/"],
		["src/content/posts", "/posts/"],
	];
	for (const [rel, prefix] of roots) {
		const dir = path.join(process.cwd(), rel);
		if (!fs.existsSync(dir)) continue;
		for (const f of fs.readdirSync(dir)) {
			if (!/\.mdx?$/.test(f)) continue;
			const slug = f.replace(/\.mdx?$/, "");
			const url = prefix + encodeURIComponent(slug) + "/";
			map.set(slug, url);
			const lower = slug.toLowerCase();
			if (!map.has(lower)) map.set(lower, url);
		}
	}
	slugMapCache = map;
	return map;
}

const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export function remarkWikilink() {
	return (tree) => {
		const map = getSlugMap();
		visit(tree, "text", (node, index, parent) => {
			if (!parent || typeof index !== "number") return;
			if (!node.value.includes("[[")) return;
			if (
				parent.type === "code" ||
				parent.type === "inlineCode" ||
				parent.type === "link" ||
				parent.type === "linkReference"
			) {
				return;
			}
			const parts = [];
			let last = 0;
			let m;
			WIKILINK.lastIndex = 0;
			while ((m = WIKILINK.exec(node.value)) !== null) {
				if (m.index > last)
					parts.push({ type: "text", value: node.value.slice(last, m.index) });
				const target = m[1].trim();
				const label = (m[2] ?? target).trim();
				const url = map.get(target) ?? map.get(target.toLowerCase());
				parts.push({
					type: "link",
					url: url ?? `#missing-${encodeURIComponent(target)}`,
					title: null,
					children: [{ type: "text", value: label }],
					data: {
						hProperties: {
							className: [
								"wikilink",
								url ? "wikilink--ok" : "wikilink--broken",
							],
							"data-wikilink": target,
						},
					},
				});
				last = m.index + m[0].length;
			}
			if (last < node.value.length)
				parts.push({ type: "text", value: node.value.slice(last) });
			if (parts.length) parent.children.splice(index, 1, ...parts);
		});
	};
}
