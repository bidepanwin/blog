/**
 * Shirone Performance Measurement Tool (P3 Observability)
 * Measures LCP, CLS, FCP, TTFB, and DOM ready times across key pages.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const TEST_PAGES = [
	{ name: "Home", path: "/" },
	{ name: "About", path: "/about/" },
	{ name: "Article", path: "/posts/digital-garden/" },
	{ name: "Moments", path: "/moments/" },
	{ name: "Archive", path: "/archive/" },
];

const isWin = process.platform === "win32";
const previewCmd = isWin ? "pnpm.cmd" : "pnpm";
const samplesPerPage = 3;

function median(values) {
	return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

async function waitForServer(url, timeoutMs = 20000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok || res.status === 200 || res.status === 304) {
				return true;
			}
		} catch {
			// retry
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`Server failed to respond at ${url} within ${timeoutMs}ms`);
}

async function measurePage(browser, baseUrl, pageDef) {
	const context = await browser.newContext();
	const page = await context.newPage();

	await page.addInitScript(() => {
		window.__perf_lcp = 0;
		window.__perf_cls = 0;

		try {
			new PerformanceObserver((entryList) => {
				for (const entry of entryList.getEntries()) {
					window.__perf_lcp = entry.startTime;
				}
			}).observe({ type: "largest-contentful-paint", buffered: true });

			new PerformanceObserver((entryList) => {
				for (const entry of entryList.getEntries()) {
					if (!entry.hadRecentInput) {
						window.__perf_cls += entry.value;
					}
				}
			}).observe({ type: "layout-shift", buffered: true });
		} catch {
			// ignore
		}
	});

	const url = `${baseUrl}${pageDef.path}`;
	const start = Date.now();
	await page.goto(url, { waitUntil: "networkidle" });
	await page.waitForTimeout(500);

	const metrics = await page.evaluate(() => {
		const nav = performance.getEntriesByType("navigation")[0] || {};
		const paint = performance.getEntriesByType("paint") || [];
		const fcp =
			paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0;

		return {
			ttfb: nav.responseStart || 0,
			domContentLoaded: nav.domContentLoadedEventEnd || 0,
			fcp,
			lcp: window.__perf_lcp || fcp,
			cls: Number((window.__perf_cls || 0).toFixed(4)),
		};
	});

	await context.close();
	return {
		page: pageDef.name,
		path: pageDef.path,
		durationMs: Date.now() - start,
		...metrics,
	};
}

async function main() {
	console.log("[perf:measure] Launching preview server check...");
	const baseUrl = process.env.PERF_BASE_URL || "http://127.0.0.1:4321";

	let serverProcess = null;
	try {
		await fetch(baseUrl);
	} catch {
		serverProcess = spawn(
			previewCmd,
			["preview", "--host", "127.0.0.1", "--port", "4321"],
			{
				stdio: "ignore",
				shell: isWin,
			},
		);
	}

	try {
		await waitForServer(baseUrl + "/");
		const browser = await chromium.launch({
			channel:
				isWin &&
				!existsSync(
					`${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
				) &&
				!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
					? "msedge"
					: "chrome",
			headless: true,
		});
		const results = [];

		console.log(
			`[perf:measure] Measuring ${TEST_PAGES.length} key pages on ${baseUrl} (${samplesPerPage} fresh-context samples each; medians and full LCP range)...`,
		);
		for (const p of TEST_PAGES) {
			try {
				const samples = [];
				for (let index = 0; index < samplesPerPage; index++) {
					samples.push(await measurePage(browser, baseUrl, p));
				}
				const res = {
					page: p.name,
					lcp: median(samples.map((sample) => sample.lcp)),
					cls: Math.max(...samples.map((sample) => sample.cls)),
					fcp: median(samples.map((sample) => sample.fcp)),
					lcpMin: Math.min(...samples.map((sample) => sample.lcp)),
					lcpMax: Math.max(...samples.map((sample) => sample.lcp)),
				};
				results.push(res);
				console.log(
					`  ${p.name.padEnd(10)} | LCP median: ${res.lcp.toFixed(1).padStart(5)}ms (range ${res.lcpMin.toFixed(1)}–${res.lcpMax.toFixed(1)}ms) | CLS max: ${res.cls.toFixed(4)} | FCP median: ${res.fcp.toFixed(1)}ms`,
				);
			} catch (err) {
				console.error(`  ? ${p.name} failed: ${err.message}`);
			}
		}

		await browser.close();
		console.log("[perf:measure] Measurement completed successfully.");
	} finally {
		if (serverProcess) {
			serverProcess.kill();
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
