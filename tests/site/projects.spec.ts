import { expect, test } from "@playwright/test";
import { registerPersistentShellSync } from "./feature-page";
import { sitePath } from "./paths";

const PROJECT_COUNT = 5;

test.describe("项目页", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(sitePath("/projects/"));
		await expect(page.locator(".project-card")).toHaveCount(PROJECT_COUNT);
	});

	test("渲染代表项目、阶段、技术栈与源码链接", async ({ page }) => {
		await expect(page.locator("#swup-container")).toHaveAttribute(
			"data-current-page",
			"projects",
		);
		// 站点默认语言为 zh_CN，文案取自 src/i18n/languages/zh_CN.ts
		await expect(page.locator(".page-header__title")).toHaveText("项目");
		await expect(page.locator(".projects-section__count")).toHaveText(
			"5 个项目",
		);

		// 内容 = 本站 + about 页列出的四个公开仓库；演示项目与 featured 均已移除
		await expect(page.locator('[data-project="shirone"]')).toHaveCount(0);
		await expect(page.locator('[data-project="folkpatch"]')).toHaveCount(0);
		await expect(page.locator('[data-project="kernelpatch"]')).toHaveCount(0);
		await expect(page.locator(".project-card--featured")).toHaveCount(0);

		// 无封面项目：渲染图标瓷砖形态（不渲染封面区）
		const chaos = page.locator('[data-project="chaos-atlas"]');
		await expect(chaos.locator("h2")).toHaveText("Chaos Atlas");
		await expect(chaos.locator(".project-card__icon")).toBeVisible();
		await expect(chaos.locator(".project-card__cover")).toHaveCount(0);
		await expect(chaos.locator('[data-phase="shipped"]')).toHaveText("已发布");
		await expect(chaos.locator(".project-card__technologies li")).toHaveCount(
			3,
		);
		await expect(chaos.getByRole("link", { name: "查看源码" })).toHaveAttribute(
			"href",
			"https://github.com/bidepanwin/chaos-atlas",
		);
	});

	test("直接加载时导航高亮与侧栏页面过滤正确", async ({ page }) => {
		await expect(
			page.locator('[data-nav-key="projects"]').first(),
		).toHaveAttribute("aria-current", "page");
		await expect(
			page.locator('widget-layout[data-id="categories"]'),
		).toBeVisible();
		await expect(page.locator('widget-layout[data-id="tags"]')).toBeVisible();
	});

	test("多个有效分类时渲染筛选 chips（lab / visual / web / ai）", async ({
		page,
	}) => {
		// ProjectSection 仅在 activeCategories.length > 1 时渲染 chips 行
		await expect(page.locator(".projects-section__chips")).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Lab", exact: true }),
		).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "可视化", exact: true }),
		).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Android", exact: true }),
		).toHaveCount(0);
		await expect(page.locator(".project-card")).toHaveCount(PROJECT_COUNT);
	});

	test("实时搜索过滤与清除（URL ?q= 同步）", async ({ page }) => {
		const searchInput = page.locator(".projects-section__search input");
		await expect(searchInput).toBeVisible();
		// ProjectSection 的搜索字段为 title/summary/category/phase/year/technologies，不含 key
		await searchInput.fill("Chaos");
		await expect(page.locator(".project-card")).toHaveCount(1);
		await expect(page.locator('[data-project="chaos-atlas"]')).toBeVisible();
		await expect(page).toHaveURL(/[?&]q=Chaos/);

		// 清除搜索恢复全部
		const clearBtn = page.locator(".projects-section__search-clear");
		await clearBtn.click();
		await expect(page.locator(".project-card")).toHaveCount(PROJECT_COUNT);
		await expect(page).not.toHaveURL(/q=/);
	});

	test("桌面与手机布局之间无刷新切换时重置瀑布流定位", async ({ page }) => {
		// 网格是 auto-fill minmax(18rem, 1fr)：容器在 1280px 视口下只有 577px，
		// 只够排 1 列。桌面多列分支需要 1600px（容器 848px）才成立。
		await page.setViewportSize({ width: 1600, height: 900 });
		const grid = page.locator(".projects-section__grid");
		const cards = page.locator(".project-card");

		await expect
			.poll(() =>
				grid.evaluate(
					(element) =>
						getComputedStyle(element)
							.gridTemplateColumns.split(" ")
							.filter(Boolean).length,
				),
			)
			.toBeGreaterThan(1);
		await expect
			.poll(() =>
				cards.evaluateAll((elements) =>
					elements.every(
						(element) =>
							(element as HTMLElement).style.gridColumnStart !== "" &&
							(element as HTMLElement).style.gridRowEnd !== "",
					),
				),
			)
			.toBe(true);
		await expect
			.poll(() =>
				cards.evaluateAll((elements) =>
					elements.every(
						(element) => getComputedStyle(element).gridColumnEnd === "span 1",
					),
				),
			)
			.toBe(true);

		await page.setViewportSize({ width: 390, height: 844 });

		await expect
			.poll(() =>
				grid.evaluate(
					(element) =>
						getComputedStyle(element)
							.gridTemplateColumns.split(" ")
							.filter(Boolean).length,
				),
			)
			.toBe(1);
		await expect
			.poll(() =>
				cards.evaluateAll((elements) =>
					elements.every(
						(element) =>
							(element as HTMLElement).style.gridColumnStart === "" &&
							(element as HTMLElement).style.gridRowEnd === "",
					),
				),
			)
			.toBe(true);
		await expect(cards).toHaveCount(PROJECT_COUNT);
		await expect(page).toHaveURL(/\/projects\/$/);

		await page.setViewportSize({ width: 1600, height: 900 });

		await expect
			.poll(() =>
				cards.evaluateAll((elements) =>
					elements.every(
						(element) =>
							(element as HTMLElement).style.gridColumnStart !== "" &&
							(element as HTMLElement).style.gridRowEnd !== "",
					),
				),
			)
			.toBe(true);
	});

	// ≥md 的网格把行距烘焙进 span（grid-auto-rows: 8px + row-gap: 0），所以
	// 单列时也必须写 span：只占一行 8px 的卡片会让下一张紧贴着叠上来。
	// 1280px 视口下内容列只有 577px，只排得下一列——正是出问题的那个状态。
	test("窄桌面单列下卡片不重叠", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const cards = page.locator(".project-card");

		await expect
			.poll(() =>
				page
					.locator(".projects-section__grid")
					.evaluate(
						(element) =>
							getComputedStyle(element)
								.gridTemplateColumns.split(" ")
								.filter(Boolean).length,
					),
			)
			.toBe(1);

		// 网格已进入「行距烘焙进 span」的模式，这正是需要 span 的前提。
		await expect
			.poll(() =>
				page
					.locator(".projects-section__grid")
					.evaluate((element) => getComputedStyle(element).gridAutoRows),
			)
			.not.toBe("auto");

		await expect
			.poll(() =>
				cards.evaluateAll((elements) =>
					elements.every(
						(element) => (element as HTMLElement).style.gridRowEnd !== "",
					),
				),
			)
			.toBe(true);

		// 逐对检查：后一张的顶边必须不早于前一张的底边。
		const boxes = await cards.evaluateAll((elements) =>
			elements.map((element) => {
				const rect = element.getBoundingClientRect();
				return { top: rect.top, bottom: rect.bottom };
			}),
		);
		for (let index = 1; index < boxes.length; index += 1) {
			expect(
				boxes[index].top,
				`第 ${index + 1} 张卡片叠到了第 ${index} 张上`,
			).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
		}
	});

	test("无封面卡片在桌面端将技术栈与源码操作合并为同一行", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const cards = page.locator(".project-card--without-cover");

		await expect(cards).toHaveCount(PROJECT_COUNT);

		const rowsMerged = await cards.evaluateAll((elements) =>
			elements.every((element) => {
				const card = element as HTMLElement;
				const technologies = card.querySelector<HTMLElement>(
					".project-card__technologies",
				);
				const actions = card.querySelector<HTMLElement>(
					".project-card__actions",
				);
				if (!technologies || !actions) return false;
				const techBox = technologies.getBoundingClientRect();
				const actionsBox = actions.getBoundingClientRect();
				// 同一行：两个区域的垂直范围必须重叠
				return (
					techBox.top < actionsBox.bottom && actionsBox.top < techBox.bottom
				);
			}),
		);

		await expect(rowsMerged).toBe(true);
	});
});

test.describe("项目页 Swup 导航", () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	registerPersistentShellSync("从持久顶栏进入后同步页面、导航与侧栏状态", {
		key: "projects",
		fromPath: sitePath("/about/"),
		toPath: /\/projects\/$/,
		cardSelector: "project-card",
		cardCount: PROJECT_COUNT,
	});
});
