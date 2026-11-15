import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { siteConfig } from "../../src/config/siteConfig";
import { sitePath } from "./paths";

const introSelector = "#home-intro";
const titleSelector = "[data-banner-home-copy] h1 [data-typewriter-text]";

async function freshHome(page: Page, theme = "dark") {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await page.addInitScript(
		(value) => localStorage.setItem("theme", value),
		theme,
	);
	// Observe the early overlay while the rest of the document and modules load.
	await page.goto(sitePath(), { waitUntil: "commit" });
}

async function expectReleased(page: Page) {
	await expect(page.locator(introSelector)).not.toBeVisible({
		timeout: 10_000,
	});
	expect(await page.evaluate(() => window.__introPlayed)).not.toBe(true);
	await expect(page.locator("html")).not.toHaveClass(/intro-on/);
	expect(
		await page.evaluate(
			() => getComputedStyle(document.documentElement).overflow,
		),
	).not.toBe("hidden");
}

test.describe("Homepage opening sequence", () => {
	test.skip(!siteConfig.intro?.enable, "Opening sequence is optional");

	test("plays once, types its own text, then hands off to the homepage", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await freshHome(page);
		const intro = page.locator(introSelector);
		await expect(intro).toBeVisible();
		await expect(intro).toHaveAttribute("data-playing", "true");
		await expect(intro.locator("[data-intro-skip]")).toBeFocused();
		const titleDuringIntro = await page.locator(titleSelector).textContent();
		await page.waitForTimeout(350);
		expect(await page.locator(titleSelector).textContent()).toBe(
			titleDuringIntro,
		);
		await expect
			.poll(() => intro.locator("[data-intro-tagline]").textContent())
			.toBe(siteConfig.intro?.tagline);
		await expectReleased(page);
		expect(
			await page.evaluate(() => sessionStorage.getItem("introPlayed")),
		).toBe("1");
		await expect
			.poll(() => page.locator(titleSelector).textContent())
			.not.toBe(titleDuringIntro);
		await page.reload({ waitUntil: "domcontentloaded" });
		await expectReleased(page);
		expect(errors).toEqual([]);
	});

	test("skip and Escape release the modal; replay works after Swup navigation", async ({
		page,
	}) => {
		await freshHome(page);
		await page.locator("[data-intro-skip]").click();
		await expectReleased(page);
		const replay = page.locator("#fab-replay-btn");
		await expect(replay).toBeVisible();
		await replay.click();
		await expect(page.locator(introSelector)).toBeVisible();
		await page.keyboard.press("Escape");
		await expectReleased(page);
		await expect(replay.getByRole("button")).toBeFocused();
		await page
			.locator(`a[href="${sitePath("about/")}"]`)
			.first()
			.click();
		await expect(page).toHaveURL(new RegExp(`${sitePath("about/")}$`));
		await expect(replay).toBeHidden();
		await expectReleased(page);
		await page.locator(`a[href="${sitePath()}"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`${sitePath()}$`));
		await expectReleased(page);
		await expect(replay).toBeVisible();
		await replay.click();
		await expect(page.locator(introSelector)).toBeVisible();
		await page.keyboard.press("Escape");
		await expectReleased(page);
	});

	test("a direct article and returning to the homepage remain immediately usable", async ({
		page,
	}) => {
		await page.goto(sitePath("posts/digital-garden/"));
		await expectReleased(page);
		await expect(page.locator("#swup-container")).toHaveAttribute(
			"data-current-page",
			"post",
		);
		await expect(page.locator("#fab-replay-btn")).toBeHidden();
		await page.locator(`a[href="${sitePath()}"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`${sitePath()}$`));
		await expectReleased(page);
		await page.locator("#fab-replay-btn").click();
		await expect(page.locator(introSelector)).toBeVisible();
		await page.keyboard.press("Escape");
	});

	for (const preference of ["system", "site"]) {
		test(`respects ${preference} reduced motion, including replay`, async ({
			page,
		}) => {
			await page.emulateMedia({
				reducedMotion: preference === "system" ? "reduce" : "no-preference",
			});
			if (preference === "site") {
				await page.addInitScript(() =>
					localStorage.setItem("mc-motion", "reduced"),
				);
			}
			await page.goto(sitePath());
			await expectReleased(page);
			await page.locator("#fab-replay-btn").click();
			await expectReleased(page);
			await expect(page.locator(titleSelector)).toHaveText(
				siteConfig.banner.homeText.title,
			);
		});
	}

	test("a motion preference change during playback immediately releases the page", async ({
		page,
	}) => {
		await freshHome(page);
		await expect(page.locator(introSelector)).toBeVisible();
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expectReleased(page);
		await expect(page.locator(titleSelector)).toHaveText(
			siteConfig.banner.homeText.title,
		);
	});

	test("unavailable storage and failed images cannot trap visitors", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, "sessionStorage", {
				get() {
					throw new DOMException("Storage blocked", "SecurityError");
				},
			});
		});
		await page.route(/\.(?:webp|avif|png|jpe?g)(?:\?.*)?$/, (route) =>
			route.abort(),
		);
		await freshHome(page);
		await expect(page.locator(introSelector)).toBeVisible();
		await expectReleased(page);
		await expect(page.locator("#navbar")).toBeVisible();
	});

	test("the homepage stays readable without JavaScript", async ({
		browser,
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto(`${test.info().project.use.baseURL}${sitePath()}`);
			await expect(page.locator(introSelector)).toBeHidden();
			await expect(page.locator("[data-banner-home-copy] h1")).toBeVisible();
		} finally {
			await context.close();
		}
	});

	for (const theme of ["light", "dark"]) {
		test(`active dialog is accessible and fits mobile in ${theme} mode`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await freshHome(page, theme);
			await expect(page.locator(introSelector)).toBeVisible();
			await expect(page.locator("[data-intro-skip]")).toBeFocused();
			const results = await new AxeBuilder({ page })
				.include(introSelector)
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze();
			expect(results.violations).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await page.keyboard.press("Tab");
			await expect(page.locator("[data-intro-skip]")).toBeFocused();
			await page.keyboard.press("Escape");
			await expectReleased(page);
		});
	}
});
