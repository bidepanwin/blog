#!/usr/bin/env node
/**
 * sync-reports.mjs — 把 frontier-report 项目的日报/周报同步进博客 reports collection。
 *
 * 源（自动探测，先试 WSL 的 /mnt/f，再试 Windows 的 F:）：
 *   <root>/daily-report/archives/ai-daily-report-YYYY-MM-DD.md   → src/content/reports/daily-YYYY-MM-DD.md
 *   <root>/weekly-report/archives/ai-weekly-ideas-YYYY-MM-DD.md  → src/content/reports/weekly-YYYY-MM-DD.md
 *
 * 行为：
 *   - 给每份报告补上 Astro frontmatter，正文原样保留（仅去 BOM、CRLF→LF）；
 *   - 幂等：目标已存在同日期文件则跳过；
 *   - 默认只处理「今天起」的报告（文件名日期 >= 今天），历史存量不导入；
 *   - 不自提交 git（由外层调用者处理）。
 *
 * 用法：
 *   node scripts/sync-reports.mjs            # 只同步今天及以后的
 *   node scripts/sync-reports.mjs --all      # 导入全部历史
 *   node scripts/sync-reports.mjs --since 2026-10-01   # 同步指定日期以来的
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BLOG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIR = join(BLOG_ROOT, "src", "content", "reports");

const SOURCE_CANDIDATES = [
	"/mnt/f/project/Frontier Daily Weekly Report", // WSL
	"F:/project/Frontier Daily Weekly Report", // Windows 原生
];

const KINDS = [
	{
		subdir: join("daily-report", "archives"),
		pattern: /^ai-daily-report-(\d{4}-\d{2}-\d{2})\.md$/,
		targetPrefix: "daily-",
		title: (d) => `AI Frontier Daily · ${d}`,
		category: "Daily",
		tags: ["Daily", "AI"],
	},
	{
		subdir: join("weekly-report", "archives"),
		pattern: /^ai-weekly-ideas-(\d{4}-\d{2}-\d{2})\.md$/,
		targetPrefix: "weekly-",
		title: (d) => `AI Frontier Weekly · ${d}`,
		category: "Weekly",
		tags: ["Weekly", "AI"],
	},
];

function parseArgs(argv) {
	let since = null;
	let all = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--all") all = true;
		else if (argv[i] === "--since") {
			const v = argv[++i];
			if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
				console.error(`--since 需要 YYYY-MM-DD 参数，收到: ${v ?? "(空)"}`);
				process.exit(1);
			}
			since = v;
		} else if (argv[i]?.startsWith("--since=")) {
			const v = argv[i].slice("--since=".length);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
				console.error(`--since 需要 YYYY-MM-DD 参数，收到: ${v}`);
				process.exit(1);
			}
			since = v;
		}
	}
	return { since, all };
}

function localToday() {
	const d = new Date();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

const { since, all } = parseArgs(process.argv.slice(2));
const cutoff = all ? "0000-00-00" : (since ?? localToday());

const sourceRoot = SOURCE_CANDIDATES.find((p) => existsSync(p));
if (!sourceRoot) {
	console.error(
		`frontier-report 源目录不存在，已尝试: ${SOURCE_CANDIDATES.join(" | ")}`,
	);
	process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });

let added = 0;
let skipped = 0;
let filtered = 0;

for (const kind of KINDS) {
	const dir = join(sourceRoot, kind.subdir);
	if (!existsSync(dir)) {
		console.warn(`跳过缺失目录: ${dir}`);
		continue;
	}
	for (const file of readdirSync(dir)) {
		const m = file.match(kind.pattern);
		if (!m) continue;
		const date = m[1];
		// ISO 日期可直接按字符串比较
		if (date < cutoff) {
			filtered++;
			continue;
		}
		const target = join(TARGET_DIR, `${kind.targetPrefix}${date}.md`);
		if (existsSync(target)) {
			skipped++;
			continue;
		}
		const body = readFileSync(join(dir, file), "utf8")
			.replace(/^﻿/, "") // BOM
			.replace(/\r\n/g, "\n");
		const frontmatter = [
			"---",
			`title: "${kind.title(date)}"`,
			`published: ${date}`,
			`category: "${kind.category}"`,
			`tags: [${kind.tags.map((t) => `"${t}"`).join(", ")}]`,
			`lang: "zh-CN"`,
			"---",
		].join("\n");
		writeFileSync(target, `${frontmatter}\n\n${body}`, "utf8");
		added++;
	}
}

if (filtered > 0) {
	console.log(
		`filtered ${filtered} 篇早于 ${cutoff} 的报告（导入全部历史请用 --all）`,
	);
}
console.log(`added ${added}, skipped ${skipped}`);
