import { expect, test } from "@playwright/test";

const postIds = [
	"2026-10-17-hello",
	"2026-10-18-animaeva-memory-eval",
	"2026-10-18-careeratlas",
	"2026-10-18-frontier-report",
	"2026-10-18-olympia",
	"2026-10-18-seeker-learning-region-market",
	"2026-10-19-dsh-dotclaude",
	"2026-10-25-shardseek",
	"2026-11-02-blog-as-graph",
	"2026-11-06-diting",
];

test("both list pages show ten distinct local covers", async ({ page }) => {
	const sources: string[] = [];
	for (const route of ["/", "/2/"]) {
		await page.goto(route, { waitUntil: "domcontentloaded" });
		const cards = page.locator(".m3-blog-postcard");
		await expect(cards).toHaveCount(route === "/" ? 8 : 2);
		for (const card of await cards.all()) {
			const cover = card.locator("a.m3-blog-postcard__cover");
			await expect(cover).toHaveCount(1);
			expect((await cover.getAttribute("href"))?.startsWith("/")).toBe(true);
			const image = cover.locator("img");
			await image.scrollIntoViewIfNeeded();
			await expect
				.poll(() =>
					image.evaluate(
						(element) =>
							element instanceof HTMLImageElement &&
							element.complete &&
							element.naturalWidth > 0,
					),
				)
				.toBe(true);
			sources.push((await image.getAttribute("src")) || "");
		}
	}
	expect(sources).toHaveLength(10);
	expect(new Set(sources).size).toBe(10);
	for (const source of sources)
		expect(new URL(source, "http://localhost:4321").origin).toBe(
			"http://localhost:4321",
		);
});

test("every detail page has an eager responsive cover and OG image", async ({
	page,
}) => {
	for (const postId of postIds) {
		await page.goto(`/posts/${postId}/`, { waitUntil: "domcontentloaded" });
		const image = page.locator("#post-cover img");
		await expect(image).toHaveAttribute("loading", "eager");
		await expect(image).toHaveAttribute("fetchpriority", "high");
		await expect(
			page.locator('#post-cover source[type="image/avif"]'),
		).toHaveCount(1);
		await expect(
			page.locator('#post-cover source[type="image/webp"]'),
		).toHaveCount(1);
		await expect
			.poll(() =>
				image.evaluate(
					(element) =>
						element instanceof HTMLImageElement &&
						element.complete &&
						element.naturalWidth > 0,
				),
			)
			.toBe(true);
		const source = (await image.getAttribute("src")) || "";
		expect(new URL(source, "http://localhost:4321").origin).toBe(
			"http://localhost:4321",
		);
		await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
	}
});

test("every legacy blog route keeps the same local cover", async ({ page }) => {
	for (const postId of postIds) {
		await page.goto(`/blog/${postId}/`, { waitUntil: "domcontentloaded" });
		const image = page.locator("#post-cover img");
		await expect(image).toHaveCount(1);
		await expect
			.poll(() =>
				image.evaluate(
					(element) =>
						element instanceof HTMLImageElement &&
						element.complete &&
						element.naturalWidth > 0,
				),
			)
			.toBe(true);
		const source = (await image.getAttribute("src")) || "";
		expect(new URL(source, "http://localhost:4321").origin).toBe(
			"http://localhost:4321",
		);
	}
});

test("reload and mobile theme changes preserve the same local cover", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/", { waitUntil: "domcontentloaded" });
	const first = page.locator(".m3-blog-postcard__cover img").first();
	const original = await first.getAttribute("src");
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(first).toHaveAttribute("src", original || "");
	for (const theme of ["light", "dark"]) {
		await page.addInitScript(
			(value) => localStorage.setItem("theme", value),
			theme,
		);
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(first).toHaveAttribute("src", original || "");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	}
});
