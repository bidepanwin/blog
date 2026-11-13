import { expect, test } from "@playwright/test";

/**
 * 友链页功能锁定（pages/friends.astro -> organisms/FriendSection.svelte，client:visible）。
 * 迁移时清空了 Shirone 演示友链（Mizuki / Astro / Material 3），src/data/friends.ts
 * 的 friendsData 现为空数组：页面保留 PageHeader 与换链说明，工具栏（搜索/标签 chips/计数）
 * 在无数据时不渲染，列表区直接展示空态文案（FriendSection.svelte 的 friendsNoResults）。
 * 站点默认语言为 en（siteConfig.lang），文案断言用英文。
 */

const FRIEND_COUNT = 0;

test.describe("友链页（空数据态）", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/friends/");
		await expect(page.locator(".friend-card")).toHaveCount(FRIEND_COUNT);
		await expect(page.locator(".friend-section__empty")).toBeVisible();
	});

	test("展示空态文案，且不渲染任何友链卡片", async ({ page }) => {
		await expect(page.locator(".friend-section__empty")).toContainText(
			"No friends matched your filters",
		);
	});

	test("保留页头大标题与换链说明", async ({ page }) => {
		await expect(page.locator(".page-header")).toHaveCount(1);
		await expect(page.locator(".page-header__title")).toHaveText("Friends");
		await expect(page.locator(".page-header__icon svg")).toHaveCount(1);
		await expect(page.locator(".page-header__subtitle")).toBeVisible();
		await expect(page.locator(".page-header__subtitle")).toContainText(
			"Link exchange",
		);
	});

	test("无数据时不渲染搜索条、标签 chips 与计数", async ({ page }) => {
		await expect(page.locator(".friend-section__tools")).toHaveCount(0);
		await expect(page.locator(".friend-section__search")).toHaveCount(0);
		await expect(
			page.locator(".friend-section__chips .m3-chip--filter"),
		).toHaveCount(0);
	});

	test("带搜索参数深链（?q=Mizuki）仍是空态，不复活演示数据", async ({
		page,
	}) => {
		await page.goto("/friends/?q=Mizuki");
		await expect(page.locator(".friend-card")).toHaveCount(0);
		await expect(page.locator(".friend-section__empty")).toBeVisible();
	});
});

test.describe("友链页 Swup 导航（空数据态）", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test("重复进入后仍为空态", async ({ page }) => {
		await page.goto("/", { waitUntil: "networkidle" });

		for (let visit = 0; visit < 3; visit++) {
			await page
				.locator('#top-row a[href="/friends/"]')
				.first()
				.click();
			await expect(page).toHaveURL(/\/friends\/$/);
			await expect(page.locator(".friend-card")).toHaveCount(FRIEND_COUNT);
			await expect(page.locator(".friend-section__empty")).toBeVisible();

			await page
				.locator('#top-row a[data-nav-key="home"]')
				.first()
				.click();
			await expect(page).toHaveURL(/\/$/);
		}
	});
});
