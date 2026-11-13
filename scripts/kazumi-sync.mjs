#!/usr/bin/env node
/**
 * 从坚果云 WebDAV 拉取 Kazumi 追番历史快照，转成 Shirone anime snapshot。
 *
 * 用法：
 *   KAZUMI_WEBDAV_USER=xxx@qq.com KAZUMI_WEBDAV_PASS=应用密码 node scripts/kazumi-sync.mjs
 *
 * 环境变量：
 *   KAZUMI_WEBDAV_URL   默认 https://dav.jianguoyun.com/dav/kazumiSync/history/snapshot.json
 *   KAZUMI_WEBDAV_USER  坚果云账号
 *   KAZUMI_WEBDAV_PASS  坚果云应用密码（非登录密码）
 *
 * 输出：src/data/anime-snapshots/kazumi.json（Envelope schemaVersion:1）
 * 凭据不落盘、不入库；本脚本只读 WebDAV。
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/data/anime-snapshots/kazumi.json");

const URL_ =
	process.env.KAZUMI_WEBDAV_URL ??
	"https://dav.jianguoyun.com/dav/kazumiSync/history/snapshot.json";
const USER = process.env.KAZUMI_WEBDAV_USER;
const PASS = process.env.KAZUMI_WEBDAV_PASS;

if (!USER || !PASS) {
	console.error("✗ 缺少环境变量 KAZUMI_WEBDAV_USER / KAZUMI_WEBDAV_PASS");
	process.exit(1);
}

const auth = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

/** 不进入公开追番页的条目（bgm.tv subject id）。由用户逐项决定。 */
const EXCLUDE_IDS = new Set([
	215140, // 灵魂注入（成人向，用户决定不展示）
]);

async function main() {
	console.log("[kazumi-sync] GET", URL_);
	const res = await fetch(URL_, { headers: { Authorization: auth } });
	if (!res.ok) {
		console.error(`✗ WebDAV 返回 ${res.status}（404=还没同步过 / 401=凭据错误）`);
		process.exit(1);
	}
	const data = await res.json();

	// Kazumi history snapshot 真实结构（实测）：
	// { schemaVersion, generatedAt, histories: [ { bangumiItem, lastWatchEpisode, progresses, ... } ], ... }
	const hist = Array.isArray(data?.histories) ? data.histories : null;
	if (!hist) {
		console.error("✗ snapshot.json 结构不符合预期（没有 histories 数组）");
		process.exit(1);
	}

	// 封面下载到站内（离线/弱网不依赖 bgm.tv）
	async function localizeCover(remoteUrl, bgId) {
		if (!remoteUrl || !bgId) return undefined;
		const dir = resolve(ROOT, "public/assets/anime/covers");
		const local = `/assets/anime/covers/${bgId}.jpg`;
		const dest = resolve(dir, `${bgId}.jpg`);
		if (existsSync(dest)) return local;
		try {
			mkdirSync(dir, { recursive: true });
			const r = await fetch(remoteUrl);
			if (!r.ok) return undefined;
			writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
			return local;
		} catch {
			return undefined;
		}
	}

	const items = [];
	for (const entry of hist) {
		const bg = entry?.bangumiItem ?? entry?.bangumi ?? entry;
		const title = bg?.nameCn || bg?.name || bg?.title;
		if (!title) continue;

		const bgId = Number(bg?.id ?? 0) || 0;
		if (EXCLUDE_IDS.has(bgId)) {
			console.log(`  ⊘ 排除 ${title} (id=${bgId})`);
			continue;
		}

		// 进度：lastWatchEpisode（看到第几集）；总集数 Kazumi 不给，留 watched
		const watched = Number(entry?.lastWatchEpisode ?? 0) || 0;
		const total = Number(bg?.episodeCount ?? bg?.episodes ?? 0) || 0;
		const progress = watched > 0 ? { watched, ...(total > 0 ? { total } : {}) } : undefined;

		const remoteCover =
			bg?.images?.large ?? bg?.images?.common ?? bg?.images?.medium ??
			bg?.image ?? bg?.cover ?? undefined;
		const cover = (await localizeCover(remoteCover, bgId)) ?? remoteCover;

		const link = bgId ? `https://bgm.tv/subject/${bgId}` : undefined;

		const item = {
			title,
			...(cover ? { cover } : {}),
			...(link ? { link } : {}),
			status: total > 0 && watched >= total ? "completed" : "watching",
			rating: 0, // Kazumi 历史无个人评分；0 = 未评分
			...(progress ? { progress } : {}),
			year: String(bg?.airDate?.slice?.(0, 4) ?? bg?.year ?? ""),
			genres: Array.isArray(bg?.tags) ? bg.tags.map((t) => t?.name ?? t).filter(Boolean) : [],
			_bgId: bgId, // 内部去重用，输出前删除
		};

		// 同 id 记录合并（Kazumi 可能对同番有多条历史），取最大 watched
		const existing = items.find((x) => x._bgId === bgId && bgId > 0);
		if (existing) {
			if ((item.progress?.watched ?? 0) > (existing.progress?.watched ?? 0)) {
				existing.progress = item.progress;
			}
			console.log(`  ⇄ 合并重复 ${title} (id=${bgId})`);
			continue;
		}
		items.push(item);
	}
	for (const it of items) delete it._bgId;

	const envelope = {
		schemaVersion: 1,
		provider: "kazumi",
		fetchedAt: new Date().toISOString(),
		accountRef: USER,
		items,
	};

	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify(envelope, null, "\t") + "\n", "utf-8");
	console.log(`✓ 写入 ${items.length} 条追番 → ${OUT}`);
	for (const it of items) console.log(`  - ${it.title} (${it.status}${it.progress ? `, ${it.progress.watched}集` : ""})`);
}

main().catch((e) => {
	console.error("✗", e?.message ?? e);
	process.exit(1);
});
