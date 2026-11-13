import { expect, type Page, test } from "@playwright/test";
import { sitePath } from "./paths";

type Frame = {
	title: string;
	subtitle: string;
	titleState?: string;
	subtitleState?: string;
	titleBox: number[];
	subtitleBox: number[];
};

type Probe = {
	settings?: {
		enabled?: string;
		title?: string;
		loop?: string;
		speed?: string;
	};
	frames: Frame[];
};

type ProbeWindow = Window & { __bannerTyping: Probe };

const titleSelector = "[data-banner-home-copy] h1";
const subtitleSelector = "[data-banner-home-copy] p";

async function instrument(page: Page, manualReduced = false) {
	await page.addInitScript((manual) => {
		localStorage.setItem("theme", "dark");
		localStorage.setItem("wallpaper-mode", "banner");
		localStorage.setItem("mc-motion", manual ? "reduced" : "full");
		const probe: Probe = { frames: [] };
		(window as ProbeWindow).__bannerTyping = probe;
		let previous = "";
		new MutationObserver(() => {
			const stage = document.querySelector<HTMLElement>("#banner-wrapper");
			if (!stage) return;
			if (!probe.settings) {
				probe.settings = {
					enabled: stage.dataset.subtitleTypewriterEnabled,
					title: stage.dataset.subtitleTypewriterIncludeTitle,
					loop: stage.dataset.subtitleTypewriterLoop,
					speed: stage.dataset.subtitleTypewriterSpeed,
				};
				// Keep real production flags while shortening complete animation cycles.
				stage.dataset.subtitleTypewriterSpeed = "3";
				stage.dataset.subtitleTypewriterDeleteSpeed = "2";
				stage.dataset.subtitleTypewriterPauseTime = "100";
			}
			const title = stage.querySelector<HTMLElement>(
				"[data-banner-home-copy] h1",
			);
			const subtitle = stage.querySelector<HTMLElement>(
				"[data-banner-home-copy] p",
			);
			if (!title || !subtitle) return;
			const frame: Frame = {
				title: title.querySelector("[data-typewriter-text]")?.textContent || "",
				subtitle:
					subtitle.querySelector("[data-typewriter-text]")?.textContent || "",
				titleState: title.dataset.titleState,
				subtitleState: subtitle.dataset.subtitleState,
				titleBox: [
					title.offsetLeft,
					title.offsetTop,
					title.offsetWidth,
					title.offsetHeight,
				],
				subtitleBox: [
					subtitle.offsetLeft,
					subtitle.offsetTop,
					subtitle.offsetWidth,
					subtitle.offsetHeight,
				],
			};
			const key = JSON.stringify(frame);
			if (key === previous) return;
			previous = key;
			probe.frames.push(frame);
		}).observe(document, {
			attributes: true,
			childList: true,
			subtree: true,
			characterData: true,
		});
	}, manualReduced);
}

async function frames(page: Page) {
	return page.evaluate(() => (window as ProbeWindow).__bannerTyping.frames);
}

async function labels(page: Page) {
	return {
		title: (await page.locator(titleSelector).getAttribute("aria-label")) || "",
		subtitle:
			(await page
				.locator(subtitleSelector)
				.getAttribute("data-subtitle-label")) || "",
	};
}

async function settled(page: Page) {
	await page.waitForFunction(() => {
		return (
			getComputedStyle(document.documentElement)
				.getPropertyValue("--mc-primary")
				.trim() &&
			[...document.querySelectorAll<HTMLElement>(".onload-animation")].every(
				(element) =>
					!element.offsetParent || getComputedStyle(element).opacity === "1",
			)
		);
	});
	await page.evaluate(() => document.fonts.ready);
}

function completed(
	frames: Frame[],
	expected: { title: string; subtitle: string },
) {
	const isComplete = (frame: Frame) =>
		frame.title === expected.title &&
		frame.subtitle === expected.subtitle &&
		frame.titleState === "complete" &&
		frame.subtitleState === "complete";
	let sawTyping = false;
	return frames.filter((frame, index) => {
		if (frame.titleState === "typing" || frame.subtitleState === "typing")
			sawTyping = true;
		return (
			sawTyping &&
			isComplete(frame) &&
			(!frames[index - 1] || !isComplete(frames[index - 1]))
		);
	});
}

async function expectStableGeometry(page: Page) {
	await settled(page);
	await page.evaluate(() => {
		(window as ProbeWindow).__bannerTyping.frames = [];
	});
	const expected = await labels(page);
	await expect
		.poll(async () => completed(await frames(page), expected).length)
		.toBeGreaterThanOrEqual(2);
	const samples = await frames(page);
	for (const key of ["titleBox", "subtitleBox"] as const) {
		for (let dimension = 0; dimension < 4; dimension += 1) {
			const values = samples.map((sample) => sample[key][dimension]);
			expect(
				Math.max(...values) - Math.min(...values),
				`${key}[${dimension}] changed during typing`,
			).toBeLessThanOrEqual(1);
		}
		expect(samples[0][key][2]).toBeGreaterThan(0);
		expect(samples[0][key][3]).toBeGreaterThan(0);
	}
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
}

test("title and subtitle type, erase in reverse order, and repeat", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page);
	const response = await page.goto(sitePath(), {
		waitUntil: "domcontentloaded",
	});
	if (!response)
		throw new Error("Home navigation did not return an HTTP response");
	const html = await response.text();
	const expected = await labels(page);
	expect(expected.title).toBe("LIN'S LOG");
	expect(expected.subtitle.length).toBeGreaterThan(0);
	expect(html).toContain(`data-subtitle-label="${expected.subtitle}"`);
	expect(
		await page.evaluate(() => (window as ProbeWindow).__bannerTyping.settings),
	).toEqual({
		enabled: "true",
		title: "true",
		loop: "true",
		speed: "80",
	});
	await expect
		.poll(async () => completed(await frames(page), expected).length)
		.toBeGreaterThanOrEqual(3);
	const samples = await frames(page);
	const titleTyping = samples.findIndex(
		(sample) =>
			sample.title.length > 0 &&
			sample.title.length < expected.title.length &&
			sample.subtitle === "",
	);
	const subtitleTyping = samples.findIndex(
		(sample, index) =>
			index > titleTyping &&
			sample.title === expected.title &&
			sample.subtitle.length > 0 &&
			sample.subtitle.length < expected.subtitle.length,
	);
	const bothComplete = samples.findIndex(
		(sample, index) =>
			index > subtitleTyping &&
			sample.title === expected.title &&
			sample.subtitle === expected.subtitle &&
			sample.subtitleState === "complete",
	);
	const subtitleDeleting = samples.findIndex(
		(sample, index) =>
			index > bothComplete &&
			sample.title === expected.title &&
			sample.subtitle.length > 0 &&
			sample.subtitle.length < expected.subtitle.length,
	);
	const titleDeleting = samples.findIndex(
		(sample, index) =>
			index > subtitleDeleting &&
			sample.title.length > 0 &&
			sample.title.length < expected.title.length &&
			sample.subtitle === "",
	);
	for (const index of [
		titleTyping,
		subtitleTyping,
		bothComplete,
		subtitleDeleting,
		titleDeleting,
	])
		expect(index).toBeGreaterThanOrEqual(0);
	await expectStableGeometry(page);
});

test("mobile copy keeps its position and size through repeated cycles", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page);
	await page.goto(sitePath(), { waitUntil: "domcontentloaded" });
	await expectStableGeometry(page);
});

test("Swup stops the hidden home animation and restarts it on return", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page);
	await page.goto(sitePath(), { waitUntil: "domcontentloaded" });
	const expected = await labels(page);
	await expect
		.poll(async () => completed(await frames(page), expected).length)
		.toBeGreaterThanOrEqual(2);
	await page
		.locator(`#post-list a[href='${sitePath("/posts/astro-notes/")}']`)
		.first()
		.click();
	await expect(page.locator("#banner-wrapper")).toHaveAttribute(
		"data-copy-mode",
		"context",
	);
	await expect(page.locator(titleSelector)).toHaveText(expected.title);
	await expect(
		page.locator(`${subtitleSelector} [data-typewriter-text]`),
	).toHaveText(expected.subtitle);
	await page.evaluate(() => {
		(window as ProbeWindow).__bannerTyping.frames = [];
	});
	await page.waitForTimeout(500);
	expect(
		(await frames(page)).every(
			(sample) =>
				sample.title === expected.title &&
				sample.subtitle === expected.subtitle,
		),
	).toBe(true);
	await page.locator(`#navbar nav a[href='${sitePath()}']`).click();
	await expect(page.locator("#banner-wrapper")).toHaveAttribute(
		"data-copy-mode",
		"home",
	);
	await expect
		.poll(async () =>
			(await frames(page)).some(
				(sample) =>
					sample.title.length > 0 &&
					sample.title.length < expected.title.length &&
					sample.subtitle === "",
			),
		)
		.toBe(true);
	await expect
		.poll(async () => completed(await frames(page), expected).length)
		.toBeGreaterThanOrEqual(1);
});

for (const preference of ["system", "manual"] as const) {
	test(`${preference} reduced motion shows both complete lines without a typing loop`, async ({
		page,
	}) => {
		await page.emulateMedia({
			reducedMotion: preference === "system" ? "reduce" : "no-preference",
		});
		await instrument(page, preference === "manual");
		await page.goto(sitePath(), { waitUntil: "domcontentloaded" });
		await settled(page);
		const expected = await labels(page);
		await expect(page.locator(titleSelector)).toHaveText(expected.title);
		await expect(
			page.locator(`${subtitleSelector} [data-typewriter-text]`),
		).toHaveText(expected.subtitle);
		await expect(page.locator(titleSelector)).toHaveAttribute(
			"data-title-state",
			"complete",
		);
		await expect(page.locator(subtitleSelector)).toHaveAttribute(
			"data-subtitle-state",
			"complete",
		);
		await page.evaluate(() => {
			(window as ProbeWindow).__bannerTyping.frames = [];
		});
		await page.waitForTimeout(600);
		expect(
			(await frames(page)).every(
				(sample) =>
					sample.title === expected.title &&
					sample.subtitle === expected.subtitle,
			),
		).toBe(true);
	});
}
