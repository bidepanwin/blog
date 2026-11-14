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

async function instrument(page: Page, manualReduced = false, context = false) {
	await page.addInitScript(
		({ manual, context }) => {
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
					const prefix = context ? "contextTypewriter" : "subtitleTypewriter";
					probe.settings = {
						enabled: stage.dataset[`${prefix}Enabled`],
						title: stage.dataset[`${prefix}IncludeTitle`],
						loop: stage.dataset[`${prefix}Loop`],
						speed: stage.dataset[`${prefix}Speed`],
					};
					// Keep real production flags while shortening complete animation cycles.
					stage.dataset[`${prefix}Speed`] = "3";
					stage.dataset[`${prefix}DeleteSpeed`] = "2";
					stage.dataset[`${prefix}PauseTime`] = "100";
				}
				const title = stage.querySelector<HTMLElement>(
					context
						? "[data-banner-context-title]"
						: "[data-banner-home-copy] h1",
				);
				const subtitle = stage.querySelector<HTMLElement>(
					context
						? "[data-banner-context-description]"
						: "[data-banner-home-copy] p",
				);
				if (!title || !subtitle) return;
				const frame: Frame = {
					title:
						title.querySelector("[data-typewriter-text]")?.textContent || "",
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
		},
		{ manual: manualReduced, context },
	);
}

async function frames(page: Page) {
	return page.evaluate(() => (window as ProbeWindow).__bannerTyping.frames);
}

async function labels(page: Page, context = false) {
	const activeTitle = context ? "[data-banner-context-title]" : titleSelector;
	const activeSubtitle = context
		? "[data-banner-context-description]"
		: subtitleSelector;
	return {
		title: (await page.locator(activeTitle).getAttribute("aria-label")) || "",
		subtitle:
			(await page
				.locator(activeSubtitle)
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

async function expectStableGeometry(page: Page, context = false) {
	await settled(page);
	await page.evaluate(() => {
		(window as ProbeWindow).__bannerTyping.frames = [];
	});
	const expected = await labels(page, context);
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

async function currentMedia(page: Page) {
	return page.locator("#swup-container").evaluate((container) => {
		const media = JSON.parse(
			(container as HTMLElement).dataset.bannerMedia || "{}",
		);
		return media as {
			desktop: { light: string[]; dark: string[] };
			mobile: { light: string[]; dark: string[] };
			dimOpacity: number;
		};
	});
}

async function expectCurrentImage(page: Page, mobile = false) {
	const media = await currentMedia(page);
	const expected = (mobile ? media.mobile : media.desktop).dark[0];
	await expect
		.poll(async () =>
			page.locator(".banner-stage__image--active").getAttribute("src"),
		)
		.toBe(expected);
	await expect(page.locator("#banner-wrapper")).toHaveCSS(
		"--banner-dim-opacity",
		String(media.dimOpacity),
	);
	return expected;
}

test("section copy loops with stable geometry and route-specific media", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page, false, true);
	await page.goto(sitePath("/archive/"), { waitUntil: "domcontentloaded" });
	await expect(page.locator("#banner-wrapper")).toHaveAttribute(
		"data-copy-mode",
		"context",
	);
	const expected = await labels(page, true);
	expect(expected.title.length).toBeGreaterThan(0);
	expect(expected.subtitle.length).toBeGreaterThan(0);
	await expectStableGeometry(page, true);
	const archiveImage = await expectCurrentImage(page);
	const archiveMedia = await currentMedia(page);
	expect(archiveMedia.desktop.dark).toHaveLength(1);
	expect(archiveMedia.mobile.dark).toHaveLength(1);
	await page
		.locator("#banner-wrapper")
		.evaluate((stage) => stage.setAttribute("data-test-preserved", "true"));

	await page.locator(`#navbar nav a[href='${sitePath("/about/")}']`).click();
	await expect(page.locator("#swup-container")).toHaveAttribute(
		"data-current-page",
		"about",
	);
	await expect(page.locator("#banner-wrapper")).toHaveAttribute(
		"data-test-preserved",
		"true",
	);
	const aboutImage = await expectCurrentImage(page);
	expect(aboutImage).not.toBe(archiveImage);
	await expect(page.locator(".banner-stage__media picture source")).toHaveCount(
		0,
	);
	await expectStableGeometry(page, true);

	await page.goBack();
	await expect(page.locator("#swup-container")).toHaveAttribute(
		"data-current-page",
		"archive",
	);
	expect(await expectCurrentImage(page)).toBe(archiveImage);
	await expect(page.locator("[data-banner-context-title]")).toHaveAttribute(
		"aria-label",
		expected.title,
	);
	await expectStableGeometry(page, true);
	await page.goForward();
	await expect(page.locator("#swup-container")).toHaveAttribute(
		"data-current-page",
		"about",
	);
	expect(await expectCurrentImage(page)).toBe(aboutImage);
});

test("mobile section banner types, changes viewport media, and honors live reduced motion", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page, false, true);
	await page.goto(sitePath("/books/"), { waitUntil: "domcontentloaded" });
	await expect(page.locator("#banner-wrapper")).toBeVisible();
	const mobileImage = await expectCurrentImage(page, true);
	await expectStableGeometry(page, true);
	const expected = await labels(page, true);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect(
		page.locator("[data-banner-context-title] [data-typewriter-text]"),
	).toHaveText(expected.title);
	await expect(
		page.locator("[data-banner-context-description] [data-typewriter-text]"),
	).toHaveText(expected.subtitle);
	await expect(page.locator("[data-banner-context-title]")).toHaveAttribute(
		"data-title-state",
		"complete",
	);
	await page.evaluate(() => {
		(window as ProbeWindow).__bannerTyping.frames = [];
	});
	await page.waitForTimeout(350);
	expect(
		(await frames(page)).every(
			(sample) =>
				sample.title === expected.title &&
				sample.subtitle === expected.subtitle,
		),
	).toBe(true);
	await page.setViewportSize({ width: 1440, height: 1000 });
	expect(await expectCurrentImage(page)).not.toBe(mobileImage);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expectStableGeometry(page, true);
	await page.evaluate(() => {
		localStorage.setItem("mc-motion", "reduced");
		document.documentElement.classList.add("motion-reduced");
	});
	await expect(
		page.locator("[data-banner-context-title] [data-typewriter-text]"),
	).toHaveText(expected.title);
	await expect(page.locator("[data-banner-context-title]")).toHaveAttribute(
		"data-title-state",
		"complete",
	);
	await page.evaluate(() => {
		localStorage.setItem("mc-motion", "full");
		document.documentElement.classList.remove("motion-reduced");
	});
	await expectStableGeometry(page, true);
});

test("a section without supporting copy still loops its title without empty details", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await instrument(page, false, true);
	await page.goto(sitePath("/about/"), { waitUntil: "domcontentloaded" });
	await settled(page);
	await page.evaluate(() => {
		const container = document.getElementById("swup-container");
		if (!container) throw new Error("Missing route container");
		container.dataset.bannerDescription = container.dataset.bannerTitle;
		container.dataset.bannerDate = "";
		document.dispatchEvent(new Event("swup:page:view"));
		(window as ProbeWindow).__bannerTyping.frames = [];
	});
	await expect(page.locator("[data-banner-context-details]")).toBeHidden();
	const expected = await labels(page, true);
	expect(expected.subtitle).toBe("");
	await expect
		.poll(async () => completed(await frames(page), expected).length)
		.toBeGreaterThanOrEqual(2);
	await expect(
		page.locator("[data-banner-context-description]"),
	).toHaveAttribute("data-subtitle-state", "complete");
});
