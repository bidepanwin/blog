import { expect, test } from "@playwright/test";

/**
 * 番剧页功能锁定（pages/anime.astro -> organisms/AnimeSection.svelte，client:only）。
 * 交互语言与友链/动态页同构：PageHeader 页内大标题（装饰图标）、
 * 官方 Chips 状态筛选原子（单选、再点取消）、筛选状态 URL 同步（?status=）、
 * LoadingIndicator 三段过渡、加载更多按钮。
 * 布局形态跟随全局文章列表偏好（localStorage `post-list-mode`，DisplaySettings
 * 切换广播 post-list-layout-change 事件）：grid 海报网格 / list 横向卡。
 * 数据来自 src/data/anime.ts（本地数据源按数据文件声明顺序渲染，不经 sortAnimeList），
 * 当前为 5 条迁移占位数据（文件顺序）：
 * Lycoris Recoil（completed 2022，唯一带站内封面 lkls.webp）、
 * Bocchi the Rock!（completed 2022，渐变占位）、Frieren（completed 2023，渐变占位）、
 * Laid-Back Camp（watching 5/12）、K-ON!（planned）；
 * 站点默认语言为 en（siteConfig.lang），文案断言用英文。
 */

const ANIME_COUNT = 5;

test.describe("番剧页", () => {
	test.beforeEach(async ({ page }) => {
		// 卡片级断言跑在确定布局下：预置 grid 偏好（默认 list 见专项用例）
		await page.addInitScript(() =>
			localStorage.setItem("post-list-mode", "grid"),
		);
		await page.goto("/anime/");
		await expect(page.locator(".anime-card")).toHaveCount(ANIME_COUNT);
	});

	test("渲染番剧卡片（状态 pill / 评分 / 封面占位或真实图 / 进度条）", async ({
		page,
	}) => {
		// 本地数据源按文件顺序渲染：首张 Lycoris Recoil（唯一带站内封面的条目）
		const first = page.locator(".anime-card").first();
		await expect(first).toHaveAttribute("data-status", "completed");
		await expect(first.locator(".anime-card__title")).toHaveText(
			"Lycoris Recoil",
		);
		// 状态 tonal pill（i18n 文案 + 语义色注入）
		await expect(first.locator(".anime-card__status")).toHaveText("Completed");
		await expect(first.locator(".anime-card__status")).toHaveCSS(
			"color",
			/rgb\(|var\(--tertiary\)/,
		);
		// 评分 scrim pill（封面右上，star + 数字；Svelte 直接插值，9.0 渲染为 9）
		await expect(first.locator(".anime-card__rating")).toContainText("9");
		// 带封面条目渲染真实 img，封面是 Bilibili 外链 <a>（带悬停播放层）
		await expect(first.locator(".anime-card__cover-img")).toHaveCount(1);
		await expect(first.locator(".anime-card__placeholder")).toHaveCount(0);
		await expect(first.locator("a.anime-card__cover")).toHaveCount(1);
		await expect(first.locator("a.anime-card__cover")).toHaveAttribute(
			"href",
			/https:\/\/www\.bilibili\.com\/bangumi\/media\/md28338623/,
		);
		await expect(first.locator(".anime-card__play")).toHaveCount(1);
		// completed 卡不渲染进度条；元信息行与题材弱标签
		await expect(first.locator(".m3-progress--linear")).toHaveCount(0);
		await expect(first.locator(".anime-card__meta")).toHaveText(
			"2022 · A-1 Pictures",
		);
		await expect(first.locator(".anime-card__genre").first()).toHaveText(
			"#Action",
		);

		// 无封面的 completed 条目：tv 水印渐变占位，封面仍是 bgm.tv 外链
		const bocchi = page.locator(".anime-card", {
			hasText: "Bocchi the Rock!",
		});
		await expect(bocchi.locator(".anime-card__cover-img")).toHaveCount(0);
		await expect(bocchi.locator(".anime-card__placeholder")).toBeVisible();
		await expect(bocchi.locator("a.anime-card__cover")).toHaveAttribute(
			"href",
			/https:\/\/bgm\.tv\/subject\/30187/,
		);

		const frieren = page.locator(".anime-card", { hasText: "Frieren" });
		await expect(frieren.locator(".anime-card__cover-img")).toHaveCount(0);
		await expect(frieren.locator(".anime-card__placeholder")).toBeVisible();
		await expect(frieren.locator("a.anime-card__cover")).toHaveAttribute(
			"href",
			/https:\/\/bgm\.tv\/subject\/356688/,
		);
		await expect(frieren.locator(".anime-card__rating")).toContainText("9.5");

		// watching 卡：Laid-Back Camp，determinate 进度 + 5/12
		const watching = page
			.locator('.anime-card[data-status="watching"]')
			.first();
		await expect(watching.locator(".anime-card__title")).toHaveText(
			"Laid-Back Camp",
		);
		await expect(watching.locator(".m3-progress--linear")).toHaveCount(1);
		await expect(watching.locator(".anime-card__progress-text")).toHaveText(
			"5/12",
		);

		// planned 卡：K-ON!，不渲染进度条
		const planned = page.locator('.anime-card[data-status="planned"]').first();
		await expect(planned.locator(".anime-card__title")).toHaveText("K-ON!");
		await expect(planned.locator(".m3-progress--linear")).toHaveCount(0);
	});

	test("页头与站点统一视觉结构（PageHeader + 状态筛选 chips）", async ({
		page,
	}) => {
		await expect(page.locator(".page-header")).toHaveCount(1);
		await expect(page.locator(".page-header__title")).toHaveText("Anime");
		await expect(page.locator(".page-header__icon svg")).toHaveCount(1);
		// 官方 Chips 原子（filter 形态 + 状态前置图标），只列数据中出现的状态
		const chips = page.locator(".anime-section__chips .m3-chip--filter");
		await expect(chips).toHaveCount(3);
		await expect(page.locator(".anime-section__count")).toHaveText("5 anime");
	});

	test("单选状态筛选（再点取消恢复全部，aria-pressed 同步 + URL ?status=）", async ({
		page,
	}) => {
		const watchingChip = page.getByRole("button", {
			name: "Watching",
			exact: true,
		});
		await watchingChip.click();
		await expect(watchingChip).toHaveAttribute("aria-pressed", "true");
		await expect(page).toHaveURL(/[?&]status=watching/);
		await expect(page.locator(".anime-card")).toHaveCount(1);
		await expect(page.locator(".anime-section__count")).toHaveText("1 anime");
		await watchingChip.click();
		await expect(watchingChip).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator(".anime-card")).toHaveCount(ANIME_COUNT);
		// 取消筛选后 URL 参数移除
		await expect(page).not.toHaveURL(/status=/);
	});

	test("深链恢复筛选（?status=completed）与空态", async ({ page }) => {
		await page.goto("/anime/?status=completed");
		const completedChip = page.getByRole("button", {
			name: "Completed",
			exact: true,
		});
		await expect(completedChip).toHaveAttribute("aria-pressed", "true");
		// completed ×3，顺序跟数据文件：Lycoris / Bocchi / Frieren
		await expect(page.locator(".anime-card")).toHaveCount(3);
		const titles = await page
			.locator(".anime-card__title")
			.allInnerTexts();
		expect(titles).toEqual([
			"Lycoris Recoil",
			"Bocchi the Rock!",
			"Frieren: Beyond Journey’s End",
		]);
		// 未知状态值 → 空态文案
		await page.goto("/anime/?status=nonsense");
		await expect(page.locator(".anime-section__empty")).toBeVisible();
		await expect(page.locator(".anime-section__empty")).toContainText(
			"No anime matched your filter",
		);
	});

	test("状态筛选切换播放 LoadingIndicator 过渡后揭幕", async ({ page }) => {
		await page.getByRole("button", { name: "Planned", exact: true }).click();
		// 三段过渡的指示器阶段（contained LoadingIndicator 出现在内容区）
		await expect(
			page.locator(".anime-section__loading .m3-loading--contained"),
		).toBeVisible();
		// 过渡收敛后只剩 planned 一张卡
		await expect(page.locator(".anime-card")).toHaveCount(1);
		await expect(page.locator(".anime-card__title")).toHaveText("K-ON!");
		await expect(page.locator(".anime-section__loading")).toHaveCount(0);
	});

	test("grid 布局：海报网格按容器宽度分档列数", async ({ page }) => {
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--grid/);
		// 主栏受侧栏挤压（1280 视口下内容宽 ≈ 500-600px → 3 列档），列数 ≥ 2
		const columns = await page
			.locator(".anime-list")
			.evaluate(
				(el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
			);
		expect(columns).toBeGreaterThanOrEqual(2);
	});

	test("实时搜索过滤与清除（URL ?q= 同步）", async ({ page }) => {
		const searchInput = page.locator(".anime-section__search input");
		await expect(searchInput).toBeVisible();
		await searchInput.fill("Lycoris");
		await expect(page.locator(".anime-card")).toHaveCount(1);
		await expect(page.locator(".anime-card__title")).toHaveText(
			"Lycoris Recoil",
		);
		await expect(page).toHaveURL(/[?&]q=Lycoris/);

		// 清除搜索恢复全部
		const clearBtn = page.locator(".anime-section__search-clear");
		await clearBtn.click();
		await expect(page.locator(".anime-card")).toHaveCount(ANIME_COUNT);
		await expect(page).not.toHaveURL(/q=/);
	});

	test("筛选 URL 更新保留 Swup history state", async ({ page }) => {
		await page.goto("/anime/", { waitUntil: "networkidle" });
		await page.evaluate(() => {
			history.replaceState({ ...history.state, regressionMarker: "kept" }, "");
		});
		await page.locator(".anime-section__chips button").first().click();
		await expect
			.poll(() => page.evaluate(() => history.state?.regressionMarker))
			.toBe("kept");
	});

	test("工具栏快捷切换布局（List / Grid 互切与独立状态持久化）", async ({
		page,
	}) => {
		const listBtn = page.locator(
			'.anime-section__layout-btn[aria-label="List"]',
		);
		const gridBtn = page.locator(
			'.anime-section__layout-btn[aria-label="Grid"]',
		);

		// 默认 grid 海报网格
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--grid/);
		await expect(gridBtn).toHaveAttribute("aria-pressed", "true");

		// 切换到 list 横向卡片
		await listBtn.click();
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--list/);
		await expect(listBtn).toHaveAttribute("aria-pressed", "true");
		expect(
			await page.evaluate(() =>
				localStorage.getItem("shirone:anime-layout-mode"),
			),
		).toBe("list");

		// 切换回 grid 海报网格
		await gridBtn.click();
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--grid/);
		await expect(gridBtn).toHaveAttribute("aria-pressed", "true");
		expect(
			await page.evaluate(() =>
				localStorage.getItem("shirone:anime-layout-mode"),
			),
		).toBe("grid");
	});
});

/* 番剧页专属布局形态测试：默认 grid 海报网格 / 切换 list 横向卡片 */
test.describe("番剧页布局形态（独立偏好）", () => {
	test("list 布局：横向卡片（封面固定宽 + 正文铺开）", async ({ page }) => {
		await page.addInitScript(() =>
			localStorage.setItem("shirone:anime-layout-mode", "list"),
		);
		await page.goto("/anime/");
		await expect(page.locator(".anime-card")).toHaveCount(ANIME_COUNT);
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--list/);
		const first = page.locator(".anime-card").first();
		await expect(first).toHaveCSS("flex-direction", "row");
		// 1280 视口 ≥ 768px 断点 → 11rem 封面（8.5rem 为小屏档）
		await expect(first.locator(".anime-card__cover")).toHaveCSS(
			"width",
			"176px",
		);
		// 正文铺开：标题/描述/进度在同一横排右侧
		await expect(first.locator(".anime-card__body")).toHaveCSS(
			"justify-content",
			"space-between",
		);
	});

	test("默认布局为 grid 海报网格", async ({ page }) => {
		await page.goto("/anime/");
		await expect(page.locator(".anime-card")).toHaveCount(ANIME_COUNT);
		await expect(page.locator(".anime-list")).toHaveClass(/anime-list--grid/);
	});
});
