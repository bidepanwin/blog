#!/usr/bin/env node
/**
 * 一次性迁移脚本：旧博客 ~/blog/src/content/blog/*.md
 * → Shirone 主题 ~/blog-v2/src/content/posts/*.md
 *
 * 字段映射（以 src/content.config.ts posts schema 为准）：
 *   title       → title        （不变）
 *   pubDate     → published    （不变值）
 *   tags        → tags         （数组，不变）
 *   description → description  （不变；缺失时从正文第一段提取）
 *   (无)        → category     （旧 tags 第一项；无 tags 则 "随笔"）
 *   (无)        → draft: false
 *   (无)        → lang         （正文主语言：中文 zh-CN，英文 en）
 *
 * 只重写 frontmatter 块，正文按原始子串原样保留（不经 YAML 库序列化）。
 *
 * 用法：
 *   node scripts/migrate-posts.mjs --dry-run   # 只打印映射表，不写文件
 *   node scripts/migrate-posts.mjs             # 正式写入
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const SRC_DIR = path.join(HOME, "blog", "src", "content", "blog");
const DEST_DIR = path.join(HOME, "blog-v2", "src", "content", "posts");

const DRY_RUN = process.argv.includes("--dry-run");

/** 从单行 YAML 标量取值（旧站字段全部带引号或为数组） */
function parseScalar(raw) {
	const value = raw.trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

/** 解析 tags: ["a", "b"] 形式 */
function parseTags(raw) {
	const match = raw.match(/\[(.*)\]/);
	if (!match) return [];
	return [...match[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
}

/** 正文主语言判定：先剔除代码块/行内代码（避免 jargon 与命令把中文文误判为英文），再比 CJK vs 拉丁字母 */
function detectLang(body) {
	const prose = body
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]*`/g, "");
	const cjk = (prose.match(/[一-鿿぀-ヿ가-힯]/g) ?? []).length;
	const latin = (prose.match(/[a-zA-Z]/g) ?? []).length;
	return cjk >= latin ? "zh-CN" : "en";
}

/** description 缺省回退：正文第一段非空、非标题、非代码围栏、非列表/HTML/图片的文本 */
function extractDescription(body) {
	const lines = body.split("\n");
	let inFence = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("```")) {
			inFence = !inFence;
			continue;
		}
		if (inFence || trimmed === "") continue;
		if (/^#{1,6}\s/.test(trimmed)) continue;
		if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) continue;
		if (/^<.*>$/.test(trimmed)) continue;
		if (/^!\[/.test(trimmed)) continue;
		const text = trimmed
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[*_`~#>]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text.length === 0) continue;
		return text.length > 120 ? `${text.slice(0, 119)}…` : text;
	}
	return "";
}

/** YAML 安全字符串（JSON.stringify 对中文不转义、对特殊字符自动加引号） */
function y(value) {
	return JSON.stringify(value);
}

function convert(source) {
	const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!fmMatch) throw new Error("frontmatter 块缺失");
	const fm = fmMatch[1];
	// 正文取 frontmatter 之后的原始子串，保证不被重排/转义
	const body = source.slice(fmMatch[0].length);

	const fields = {};
	for (const line of fm.split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		fields[line.slice(0, colon).trim()] = line.slice(colon + 1);
	}

	const title = fields.title ? parseScalar(fields.title) : "";
	const published = (fields.pubDate ?? "").trim();
	const tags = fields.tags ? parseTags(fields.tags) : [];
	const description =
		fields.description && parseScalar(fields.description).length > 0
			? parseScalar(fields.description)
			: extractDescription(body);
	const category = tags[0] ?? "随笔";
	const lang = detectLang(body);

	const header = [
		"---",
		`title: ${y(title)}`,
		`published: ${published}`,
		`category: ${y(category)}`,
		`tags: [${tags.map((t) => y(t)).join(", ")}]`,
		`description: ${y(description)}`,
		`lang: ${y(lang)}`,
		"draft: false",
		"---",
	].join("\n");
	// body 自带开头空行与结尾换行：header 后补一个换行即可，避免双空行
	// 文件名保持不变（旧站 post.id 即文件名），slug 不变，旧链接重定向最简单
	return { output: `${header}\n${body}`, meta: { file: "", title, published, category, tags, lang } };
}

const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".md")).sort();
console.log(`${DRY_RUN ? "[DRY-RUN] " : ""}发现 ${files.length} 篇旧文章：`);

if (!DRY_RUN) await mkdir(DEST_DIR, { recursive: true });

for (const file of files) {
	const source = await readFile(path.join(SRC_DIR, file), "utf8");
	const { output, meta } = convert(source);
	if (!DRY_RUN) {
		await writeFile(path.join(DEST_DIR, file), `${output.replace(/\s+$/, "")}\n`, "utf8");
	}
	console.log(
		`  ${file}  ->  [${meta.lang}] category=${meta.category} tags=[${meta.tags.join("/")}]`,
	);
	console.log(`    标题: ${meta.title}`);
}

console.log(DRY_RUN ? "dry-run 完成，未写入任何文件" : `已写入 ${DEST_DIR}`);
