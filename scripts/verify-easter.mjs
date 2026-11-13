/**
 * Task 5 彩蛋层 —— Playwright 结构性 + 像素直方图验证。
 *
 * headless Chromium rAF 节流严重，canvas 内容断言一律用 getImageData
 * 像素直方图（按 alpha/最近色分桶），不断言动画时刻。
 *
 * 用法：
 *   export LD_LIBRARY_PATH="$HOME/.local/pwlibs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
 *   node scripts/verify-easter.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function resolveChromium() {
	if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
	const base = join(homedir(), ".cache", "ms-playwright");
	if (!existsSync(base)) return undefined;
	return readdirSync(base)
		.filter((d) => /^chromium-\d+$/.test(d))
		.sort().reverse()
		.map((d) => join(base, d, "chrome-linux64", "chrome"))
		.find((p) => existsSync(p));
}

const PORT = 4332;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
function check(name, cond, extra = "") {
	results.push({ name, ok: !!cond });
	console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
}

async function waitForServer(url, timeoutMs = 45000) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeoutMs) {
		try { const res = await fetch(url); if (res.ok) return; } catch {}
		await sleep(400);
	}
	throw new Error(`preview not ready at ${url}`);
}

/** canvas 像素直方图：返回 alpha>阈值占比、非透明像素平均 RGB、紫罗兰系占比 */
async function canvasHistogram(page, selector, alphaCut = 5) {
	return page.evaluate(({ sel, cut }) => {
		const cv = document.querySelector(sel);
		if (!cv) return { found: false };
		const ctx = cv.getContext("2d");
		const w = cv.width, h = cv.height;
		if (!w || !h) return { found: true, empty: true };
		const { data } = ctx.getImageData(0, 0, w, h);
		// 视觉合成亮度：低 α 的亮紫在深底色上观感仍是暗纹（α≤12%）
		const bg = getComputedStyle(document.documentElement)
			.getPropertyValue("--page-bg").trim() || "rgb(20,20,30)";
		const m = bg.match(/[\d.]+/g) || [20, 20, 30];
		const bgR = Number(m[0]), bgG = Number(m[1]), bgB = Number(m[2]);
		let n = 0, rS = 0, gS = 0, bS = 0, violet = 0;
		let compR = 0, compG = 0, compB = 0;
		for (let i = 0; i < data.length; i += 4) {
			if (data[i + 3] > cut) {
				n++;
				rS += data[i]; gS += data[i + 1]; bS += data[i + 2];
				if (data[i + 2] > data[i] + 12) violet++;
				const a = data[i + 3] / 255;
				compR += data[i] * a + bgR * (1 - a);
				compG += data[i + 1] * a + bgG * (1 - a);
				compB += data[i + 2] * a + bgB * (1 - a);
			}
		}
		const total = w * h;
		return {
			found: true,
			fill: n / total,
			meanR: n ? rS / n : 0,
			meanG: n ? gS / n : 0,
			meanB: n ? bS / n : 0,
			meanBright: n ? (rS + gS + bS) / (3 * n) : 0,
			compositedBright: n ? (compR + compG + compB) / (3 * n) : 0,
			violetShare: n ? violet / n : 0,
			w, h,
		};
	}, { sel: selector, cut: alphaCut });
}

async function imgLoaded(page, selector) {
	return page.evaluate((sel) => {
		const im = document.querySelector(sel);
		return !!im && im.complete && im.naturalWidth > 0;
	}, selector);
}

const server = spawn("pnpm", ["preview", "--port", String(PORT), "--host", "127.0.0.1"], {
	cwd: process.cwd(),
	env: process.env,
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
});
server.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
server.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

let exitCode = 0;
const browser = await chromium.launch({ executablePath: resolveChromium() });
try {
	await waitForServer(`${BASE}/`);

	/* ============ 场景 1：暗色 + intro 已看过（彩蛋正常运行） ============ */
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await ctx.addInitScript(() => {
		localStorage.setItem("theme", "dark");
		sessionStorage.setItem("introPlayed", "1");
	});
	const page = await ctx.newPage();
	await page.goto(`${BASE}/`, { waitUntil: "load" });
	await sleep(1200);

	check("首页：AI 少女叙述者图片存在且已加载", await imgLoaded(page, ".char-narrator img"));
	const narratorFilter = await page.evaluate(() =>
		getComputedStyle(document.querySelector(".char-narrator img")).filter);
	check("暗色下叙述者素描反白滤镜生效", /invert/.test(narratorFilter), narratorFilter);

	check("首页：二十面体 canvas 存在", await page.locator("#icoCanvas").count() === 1);
	check("首页：数学角文案 I ≅ A₅ ↪ SO(3)",
		(await page.locator(".math-caption").first().textContent()).includes("A₅"));
	// 滚动到页脚：lazy 图片与二十面体 IntersectionObserver 都需要进入视口
	await page.locator(".math-sig").first().scrollIntoViewIfNeeded();
	await sleep(1200);
	check("页脚：交换图存在且含 g ∘ f = k ∘ h",
		(await page.locator(".math-sig").first().textContent()).replace(/\s+/g, " ").includes("g ∘ f = k ∘ h"));
	check("页脚：雨中少女图片已加载", await imgLoaded(page, ".char-footer__figure img"));
	check("Gray-Scott canvas 存在", await page.locator("#grayscottCanvas").count() === 1);
	check("Konami toast / burst canvas 存在",
		(await page.locator(".konami-toast").count()) >= 1 &&
		(await page.locator("#konamiBurstCanvas").count()) === 1);

	/* Gray-Scott 生长（headless rAF 慢，给足挂钟时间） */
	await sleep(7000);
	check("暗色：Gray-Scott 进入 is-active",
		await page.evaluate(() => document.querySelector("#grayscottCanvas").classList.contains("is-active")));
	const gsHist = await canvasHistogram(page, "#grayscottCanvas", 5);
	check("Gray-Scott：斑图已涌现（填充率 >0.5%）", gsHist.fill > 0.005, JSON.stringify(gsHist));
	check("Gray-Scott：非透明像素合成到深底后观感偏暗（<120）",
		gsHist.compositedBright < 120, `raw=${gsHist.meanBright?.toFixed(1)} composited=${gsHist.compositedBright?.toFixed(1)}`);
	check("Gray-Scott：紫罗兰/靛蓝系占主导（>60%）",
		gsHist.violetShare > 0.6, `violet=${(gsHist.violetShare * 100).toFixed(1)}%`);

	await page.locator("#icoCanvas").scrollIntoViewIfNeeded();
	await sleep(2500); // IntersectionObserver 离屏暂停：进入视口后再采样
	const icoHist = await canvasHistogram(page, "#icoCanvas", 10);
	check("二十面体：线框已绘制（非空白）", icoHist.fill > 0.001, JSON.stringify({ fill: icoHist.fill }));
	check("二十面体：线条为紫罗兰系（>60%）", icoHist.violetShare > 0.6,
		`violet=${(icoHist.violetShare * 100).toFixed(1)}%`);

	/* intro 播放协调：播放中冻结（真断言）。
	   采样器在页面里定义；先采基线，并在【同一同步任务】内立刻置
	   __introPlayed=true（采样与置位之间不可能插入 rAF），等 1200ms 再采样：
	   填充率必须不增长（容差内），整帧像素校验和必须完全一致，最后恢复。 */
	const freezeBefore = await page.evaluate(() => {
		window.__sampleGS = () => {
			const cv = document.querySelector("#grayscottCanvas");
			const ctx = cv.getContext("2d");
			const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
			let n = 0;
			let checksum = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (data[i + 3] > 5) n++;
				checksum = (checksum + data[i] + data[i + 1] + data[i + 2] + data[i + 3]) | 0;
			}
			return { fill: n / (cv.width * cv.height), checksum };
		};
		const s = window.__sampleGS();
		window.__introPlayed = true;
		return s;
	});
	await sleep(1200);
	const freezeDuring = await page.evaluate(() => window.__sampleGS());
	check("intro 协调：冻结期填充率不增长（|Δ| ≤ 0.05%）",
		Math.abs(freezeDuring.fill - freezeBefore.fill) <= 0.0005,
		`before=${freezeBefore.fill?.toFixed(4)} frozen=${freezeDuring.fill?.toFixed(4)}`);
	check("intro 协调：冻结期整帧像素完全不变（模拟与渲染停摆）",
		freezeDuring.checksum === freezeBefore.checksum,
		`before=${freezeBefore.checksum} frozen=${freezeDuring.checksum}`);
	await page.evaluate(() => { window.__introPlayed = false; });
	await sleep(2500);

	/* Konami：↑↑↓↓←→←→BA */
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.press("b");
	await page.keyboard.press("a");
	let toastShown = false;
	for (let i = 0; i < 20; i++) {
		if (await page.locator(".konami-toast.show").count()) { toastShown = true; break; }
		await sleep(60);
	}
	check("Konami：toast 弹出", toastShown);
	check("Konami：监听只绑一次（window.__konamiBound）",
		await page.evaluate(() => window.__konamiBound === true));
	await sleep(900);
	const burstOpacity = await page.evaluate(() =>
		getComputedStyle(document.querySelector("#konamiBurstCanvas")).opacity);
	check("Konami：星尘爆发 canvas 出现（opacity 趋近 1）",
		Number(burstOpacity) > 0.9, `opacity=${burstOpacity}`);

	/* Swup 切页后 Gray-Scott/Konami 仍唯一存活（Layout 级，容器外） */
	await page.goto(`${BASE}/projects/`, { waitUntil: "load" });
	await sleep(800);
	check("切到 /projects/：Gray-Scott canvas 仍唯一",
		(await page.locator("#grayscottCanvas").count()) === 1);
	check("切到 /projects/：Konami canvas 仍唯一",
		(await page.locator("#konamiBurstCanvas").count()) === 1);
	check("/projects/：炼金术士图片已加载", await imgLoaded(page, ".char-page img[src*='alchemist']"));
	await page.waitForSelector("text=frontier-report", { timeout: 10000 });
	check("/projects/：六个迁移仓库可见（frontier-report）", true);
	for (const name of ["cria-research-lab", "dsh-dotclaude", "careeratlas-app", "Zotero-MCP-Neo", "backup-ai-brain-tools-v2"]) {
		check(`/projects/：${name}`, await page.locator(`text=${name}`).count() > 0);
	}

	await page.goto(`${BASE}/about/`, { waitUntil: "load" });
	await sleep(500);
	check("/about/：窗边读书少女图片已加载", await imgLoaded(page, ".char-page img[src*='reader']"));

	await page.goto(`${BASE}/404/`, { waitUntil: "load" });
	await sleep(500);
	check("/404：小魔女图片已加载", await imgLoaded(page, ".char-404 img[src*='witch']"));
	check("/404：Gödel 文案存在",
		(await page.locator("text=/Con\\(T\\)/").count()) > 0);
	check("/404：Shirone 布局仍在（回首页按钮）",
		(await page.locator("a[href='/']").count()) > 0);
	await ctx.close();

	/* ============ 场景 2：首访（intro 播放中），Gray-Scott 不启动 ============ */
	const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await ctx2.addInitScript(() => { localStorage.setItem("theme", "dark"); });
	const page2 = await ctx2.newPage();
	await page2.goto(`${BASE}/`, { waitUntil: "load" });
	await sleep(1800);
	check("首访：intro 播放标记为 true", await page2.evaluate(() => window.__introPlayed === true));
	check("首访：Gray-Scott 未激活（无 is-active）",
		await page2.evaluate(() => !document.querySelector("#grayscottCanvas").classList.contains("is-active")));
	const freshHist = await canvasHistogram(page2, "#grayscottCanvas", 5);
	check("首访：Gray-Scott 画布全透明（未启动模拟）", freshHist.fill < 0.0005,
		`fill=${freshHist.fill}`);
	await page2.keyboard.press("Enter"); // 跳过 intro
	await page2.waitForFunction(() => window.__introPlayed === false, undefined, { timeout: 20000 }).catch(() => {});
	await sleep(5000);
	check("intro 结束后：Gray-Scott 自动激活",
		await page2.evaluate(() => document.querySelector("#grayscottCanvas").classList.contains("is-active")));
	await ctx2.close();

	/* ============ 场景 3：浅色主题，Gray-Scott 不启动 ============ */
	const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	await ctx3.addInitScript(() => {
		localStorage.setItem("theme", "light");
		sessionStorage.setItem("introPlayed", "1");
	});
	const page3 = await ctx3.newPage();
	await page3.goto(`${BASE}/`, { waitUntil: "load" });
	await sleep(2500);
	check("浅色：Gray-Scott 无 is-active",
		await page3.evaluate(() => !document.querySelector("#grayscottCanvas").classList.contains("is-active")));
	const lightHist = await canvasHistogram(page3, "#grayscottCanvas", 5);
	check("浅色：Gray-Scott 画布全透明", lightHist.fill < 0.0005, `fill=${lightHist.fill}`);
	const lightFilter = await page3.evaluate(() =>
		getComputedStyle(document.querySelector(".char-narrator img")).filter);
	check("浅色下素描无反白滤镜", lightFilter === "none", lightFilter);
	await ctx3.close();

	/* ============ 场景 4：reduced-motion 全停 ============ */
	const ctx4 = await browser.newContext({
		viewport: { width: 1280, height: 900 },
		reducedMotion: "reduce",
	});
	await ctx4.addInitScript(() => {
		localStorage.setItem("theme", "dark");
		sessionStorage.setItem("introPlayed", "1");
	});
	const page4 = await ctx4.newPage();
	await page4.goto(`${BASE}/`, { waitUntil: "load" });
	await sleep(3000);
	check("reduced-motion：Gray-Scott 无 is-active",
		await page4.evaluate(() => !document.querySelector("#grayscottCanvas").classList.contains("is-active")));
	const rmHist = await canvasHistogram(page4, "#grayscottCanvas", 5);
	check("reduced-motion：Gray-Scott 画布全透明", rmHist.fill < 0.0005, `fill=${rmHist.fill}`);
	const rmIco = await canvasHistogram(page4, "#icoCanvas", 10);
	check("reduced-motion：二十面体不绘制", rmIco.fill < 0.001, `fill=${rmIco.fill}`);
	await ctx4.close();

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} passed`);
	if (failed.length) { exitCode = 1; console.error(`${failed.length} FAILED`); }
} catch (e) {
	console.error(e);
	exitCode = 1;
} finally {
	try { await browser.close(); } catch {}
	try { process.kill(-server.pid); } catch {}
	process.exit(exitCode);
}
