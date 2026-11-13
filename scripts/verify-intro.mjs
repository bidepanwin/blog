/**
 * Task 4 雨夜 intro 遮罩 —— Playwright 结构性验证（非时序断言）。
 *
 * headless Chromium 的 rAF 严重节流，因此本脚本不断言任何 CSS 动画时刻，
 * 只断言：元素存在性、类名、display/visibility、sessionStorage、全局标记、
 * Swup 切页持久性、素材可加载。
 *
 * 完整时序（城市→终端→剪影→终幕）以用户真实浏览器目检为准。
 *
 * 用法：node scripts/verify-intro.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// 本机只缓存了完整 chromium（chrome-headless-shell 版本号不匹配），
// 自动解析 ~/.cache/ms-playwright/chromium-* 中最新的完整 chrome。
function resolveChromium() {
	if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
	const base = join(homedir(), ".cache", "ms-playwright");
	if (!existsSync(base)) return undefined;
	const candidates = readdirSync(base)
		.filter((d) => /^chromium-\d+$/.test(d))
		.sort()
		.reverse()
		.map((d) => join(base, d, "chrome-linux64", "chrome"))
		.filter((p) => existsSync(p));
	return candidates[0];
}

const PORT = 4331;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
function check(name, cond, extra = "") {
	if (cond) {
		results.push({ name, ok: true });
		console.log(`PASS  ${name}`);
	} else {
		results.push({ name, ok: false, extra });
		console.error(`FAIL  ${name} ${extra}`);
	}
}

async function waitForServer(url, timeoutMs = 45000) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {}
		await sleep(400);
	}
	throw new Error(`preview server not ready at ${url}`);
}

const server = spawn(
	"pnpm",
	["preview", "--port", String(PORT), "--host", "127.0.0.1"],
	{
		cwd: process.cwd(),
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	},
);
server.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
server.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

let exitCode = 0;
const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
	await waitForServer(`${BASE}/`);

	/* ---------- 场景 1：首访 → SKIP 点击 → 二次访问 → Swup 切页 ---------- */
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();

	let figureStatus = 0;
	page.on("response", async (res) => {
		if (res.url().includes("/assets/figure-cut-ink.webp")) figureStatus = res.status();
	});

	await page.goto(`${BASE}/`, { waitUntil: "load" });

	// 等 gate 脚本与模块脚本生效（不假设时序，轮询到状态稳定）
	await page.waitForFunction(
		() =>
			document.documentElement.classList.contains("intro-on") ||
			document.documentElement.classList.contains("intro-seen"),
		null,
		{ timeout: 10000 },
	);

	check(
		"首访：<html> 带 intro-on 且无 intro-seen/intro-reduced",
		await page.evaluate(() => {
			const c = document.documentElement.classList;
			return c.contains("intro-on") && !c.contains("intro-seen") && !c.contains("intro-reduced");
		}),
		`class="${await page.evaluate(() => document.documentElement.className)}"`,
	);
	check("首访：#intro 根元素存在且唯一", await page.locator("#intro").count() === 1);
	check(
		"首访：#intro 是 body 直子元素（Swup 容器外）",
		await page.evaluate(() => document.getElementById("intro")?.parentElement === document.body),
	);
	check(
		"首访：#intro 不在 Swup 替换容器 main/#toc 内",
		await page.evaluate(() => {
			const el = document.getElementById("intro");
			return el && el.closest("main") === null && el.closest("#toc") === null;
		}),
	);
	check(
		"首访：遮罩可见（display/visibility 未隐藏）",
		await page.evaluate(() => {
			const el = document.getElementById("intro");
			const cs = getComputedStyle(el);
			return cs.display !== "none" && cs.visibility !== "hidden";
		}),
	);
	check("首访：SKIP 按钮存在", await page.locator("#skipBtn").count() === 1);
	check(
		"首访：播放期间 #navbar 被隐藏（opacity 0 / pointer-events none）",
		await page.evaluate(() => {
			const el = document.getElementById("navbar");
			if (!el) return false;
			const cs = getComputedStyle(el);
			return cs.opacity === "0" && cs.pointerEvents === "none";
		}),
	);
	check(
		"首访：播放期间 #floating-controls 被隐藏（opacity 0 / pointer-events none）",
		await page.evaluate(() => {
			const el = document.getElementById("floating-controls");
			if (!el) return false;
			const cs = getComputedStyle(el);
			return cs.opacity === "0" && cs.pointerEvents === "none";
		}),
	);

	// 等 window.__introPlayed 置位（rAF 节流下给宽限）
	await page.waitForFunction(() => window.__introPlayed === true, null, { timeout: 10000 });
	check("首访：window.__introPlayed === true（播放中）", true);

	// 剪影素材加载（headless 下 display 不影响图片请求）
	await page.waitForResponse(
		(r) => r.url().includes("/assets/figure-cut-ink.webp"),
		{ timeout: 15000 },
	).catch(() => {});
	check("素材：figure-cut-ink.webp HTTP 200", figureStatus === 200, `status=${figureStatus}`);
	check(
		"素材：剪影图片解码成功（naturalWidth > 0）",
		await page.evaluate(async () => {
			const img = document.querySelector("#intro .figure-img");
			if (!img) return false;
			if (img.complete) return img.naturalWidth > 0;
			await new Promise((r) => { img.onload = r; img.onerror = r; });
			return img.naturalWidth > 0;
		}),
	);

	// 点击 SKIP（force：headless 下 skip-in 入场动画可能还没把 opacity 推到 1）
	await page.locator("#skipBtn").click({ force: true });
	await page.waitForFunction(() => window.__introPlayed === false, null, { timeout: 5000 });
	check("SKIP 后：window.__introPlayed === false", true);
	// 结构性终态轮询：等 0.9s 淡出过渡收敛（不断言动画中间时刻，只等承诺的终态）
	await page.waitForFunction(
		() => {
			const el = document.getElementById("intro");
			const cs = getComputedStyle(el);
			return el.classList.contains("is-done") &&
				(cs.visibility === "hidden" || cs.opacity === "0");
		},
		null,
		{ timeout: 3000 },
	);
	check(
		"SKIP 后：#intro 带 is-done 且终态不可见",
		await page.evaluate(() => {
			const el = document.getElementById("intro");
			const cs = getComputedStyle(el);
			return el.classList.contains("is-done") &&
				(cs.visibility === "hidden" || cs.opacity === "0");
		}),
	);
	check(
		"SKIP 后：sessionStorage.introPlayed === '1'",
		(await page.evaluate(() => sessionStorage.getItem("introPlayed"))) === "1",
	);
	check(
		"SKIP 后：<html> intro-on 移除",
		!(await page.evaluate(() => document.documentElement.classList.contains("intro-on"))),
	);
	check(
		"SKIP 后：#navbar 恢复可交互",
		await page.evaluate(() => {
			const el = document.getElementById("navbar");
			if (!el) return false;
			return getComputedStyle(el).pointerEvents !== "none";
		}),
	);

	// 二次 goto 首页（同一会话上下文，sessionStorage 保留）
	await page.goto(`${BASE}/`, { waitUntil: "load" });
	await page.waitForFunction(
		() =>
			document.documentElement.classList.contains("intro-seen") ||
			document.documentElement.classList.contains("intro-on"),
		null,
		{ timeout: 10000 },
	);
	check(
		"二次访问：<html> 带 intro-seen",
		await page.evaluate(() => document.documentElement.classList.contains("intro-seen")),
	);
	check(
		"二次访问：#intro display:none（不重播）",
		await page.evaluate(() => getComputedStyle(document.getElementById("intro")).display === "none"),
	);
	check(
		"二次访问：window.__introPlayed 不为 true",
		(await page.evaluate(() => !!window.__introPlayed)) === false,
	);

	// Swup 无刷新切页：intro 不被销毁、不重播
	const navHref = await page.evaluate(() => {
		const a = [...document.querySelectorAll('a[href]')].find((x) => {
			try {
				const u = new URL(x.href, location.origin);
				return u.origin === location.origin &&
					u.pathname !== "/" &&
					u.pathname !== "/404" &&
					!x.getAttribute("href").startsWith("#");
			} catch { return false; }
		});
		return a ? new URL(a.href).pathname : null;
	});
	check("Swup：首页找到一个内部导航链接", typeof navHref === "string" && navHref.length > 0,
		`href=${navHref}`);
	if (navHref) {
		await page.locator(`a[href="${navHref}"]`).first().click();
		await page.waitForFunction((h) => location.pathname === h, navHref, { timeout: 15000 });
		await sleep(600); // 等 content:replace 收尾
		check(
			"Swup：切页后 URL 变化且未整页重载",
			page.url().includes(navHref) && (await page.evaluate(() => !!window.swup)),
		);
		check(
			"Swup：切页后 #intro 仍在 DOM 且唯一（容器外存活）",
			(await page.locator("#intro").count()) === 1,
		);
		check(
			"Swup：切页后 #intro 仍是 body 直子元素",
			await page.evaluate(() => document.getElementById("intro")?.parentElement === document.body),
		);
		check(
			"Swup：切页后不重播（无 intro-on，#intro 保持隐藏）",
			await page.evaluate(() => {
				const el = document.getElementById("intro");
				return !document.documentElement.classList.contains("intro-on") &&
					(el.classList.contains("is-done") || getComputedStyle(el).display === "none");
			}),
		);
		check(
			"Swup：切页后 __introPlayed 保持 false",
			(await page.evaluate(() => !!window.__introPlayed)) === false,
		);
	}
	await ctx.close();

	/* ---------- 场景 2：按键 SKIP（Enter） ---------- */
	const ctxKey = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const pageKey = await ctxKey.newPage();
	await pageKey.goto(`${BASE}/`, { waitUntil: "load" });
	await pageKey.waitForFunction(() => document.documentElement.classList.contains("intro-on"),
		null, { timeout: 10000 });
	await pageKey.waitForFunction(() => window.__introPlayed === true, null, { timeout: 10000 });
	await pageKey.keyboard.press("Enter");
	await pageKey.waitForFunction(() => window.__introPlayed === false, null, { timeout: 5000 });
	check(
		"按键 SKIP：Enter 后 #intro 带 is-done 且 sessionStorage 已写入",
		(await pageKey.evaluate(() =>
			document.getElementById("intro").classList.contains("is-done") &&
			sessionStorage.getItem("introPlayed") === "1"
		)) === true,
	);
	await ctxKey.close();

	/* ---------- 场景 3：prefers-reduced-motion ---------- */
	const ctxRm = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		reducedMotion: "reduce",
	});
	const pageRm = await ctxRm.newPage();
	await pageRm.goto(`${BASE}/`, { waitUntil: "load" });
	await pageRm.waitForFunction(
		() => document.documentElement.classList.contains("intro-reduced"),
		null,
		{ timeout: 10000 },
	);
	check(
		"reduced-motion：<html> 带 intro-reduced 与 intro-seen",
		await pageRm.evaluate(() =>
			document.documentElement.classList.contains("intro-reduced") &&
			document.documentElement.classList.contains("intro-seen")
		),
	);
	check(
		"reduced-motion：#intro display:none，不播放",
		await pageRm.evaluate(() =>
			getComputedStyle(document.getElementById("intro")).display === "none"
		),
	);
	check(
		"reduced-motion：不写 sessionStorage、__introPlayed 不为 true",
		(await pageRm.evaluate(() =>
			sessionStorage.getItem("introPlayed") === null && !window.__introPlayed
		)) === true,
	);
	await ctxRm.close();
} catch (err) {
	console.error("HARNESS ERROR:", err);
	exitCode = 2;
} finally {
	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} structural checks passed`);
	if (failed.length) exitCode = exitCode || 1;
	await browser.close().catch(() => {});
	try { process.kill(-server.pid, "SIGTERM"); } catch {}
	process.exit(exitCode);
}
