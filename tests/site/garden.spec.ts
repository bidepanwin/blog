import { expect, test } from "@playwright/test";
import { siteConfig } from "../../src/config/siteConfig";
import { sitePath } from "./paths";

async function open(page: import("@playwright/test").Page, path = "/") {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("wallpaper-mode", "banner");
  });
  await page.goto(sitePath(path), { waitUntil: "networkidle" });
  await page.waitForFunction(() => [...document.querySelectorAll(".onload-animation")].every(el => !(el as HTMLElement).offsetParent || getComputedStyle(el).opacity === "1"));
}

test("reference banner, full navigation, and both sidebars render on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await expect(page.locator("[data-banner-home-copy] h1")).toHaveText(
    siteConfig.banner.homeText.enable ? siteConfig.banner.homeText.title : siteConfig.title,
  );
  await expect(page.locator("#navbar nav a")).toHaveCount(12);
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#sidebar-secondary")).toBeVisible();
  await expect(page.locator("#post-list > article")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const broken = await page.locator("img[src]").evaluateAll(imgs => imgs.filter(img => (img as HTMLImageElement).complete && !(img as HTMLImageElement).naturalWidth).map(img => img.getAttribute("src")));
  expect(broken).toEqual([]);
});

test("article navigation updates the persistent banner, navigation, and TOC", async ({ page }) => {
  await open(page);
  await expect(page.locator(`#category-bar a[href='${sitePath()}']`)).toHaveClass(/m3-chip--selected/);
  await page.locator(`#post-list a[href='${sitePath("/posts/astro-notes/")}']`).first().click();
  await expect(page).toHaveURL(/\/posts\/astro-notes\//);
  await expect(page.locator("#swup-container h1")).toContainText("用 Astro");
  await expect(page.locator("#toc")).toBeVisible();
  await expect(page.locator("#banner-wrapper")).toHaveAttribute("data-copy-mode", "context");
  await page.locator(`#navbar nav a[href='${sitePath()}']`).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#navbar nav a[aria-current='page']")).toHaveText("首页");
  await expect(page.locator(`#category-bar a[href='${sitePath()}']`)).toHaveClass(/m3-chip--selected/);
  await expect(page.locator("#post-list > article")).toHaveCount(6);
});

test("Ctrl+K searches the actual Markdown and handles no matches", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox").fill("Astro");
  await expect(dialog.locator(`a[href='${sitePath("/posts/astro-notes/")}']`)).toBeVisible();
  await dialog.getByRole("searchbox").fill("nothing-matches-this-query-123");
  await expect(dialog.locator(".garden-search-empty")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("mobile drawer opens, closes with Escape, and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const button = page.locator("#nav-drawer-switch");
  await button.click();
  await expect(page.locator(".site-drawer")).toHaveClass(/site-drawer--open/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".site-drawer")).not.toHaveClass(/site-drawer--open/);
  await button.click();
  await page.locator(`.site-drawer a[href='${sitePath("/books/")}']`).click();
  await expect(page).toHaveURL(/\/books\//);
  await expect(page.locator("#swup-container h1")).toHaveText("书单");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("restored columns contain real pages and usable data", async ({ page }) => {
  for (const [path, selector, count] of [
    ["/reports/", ".reports-item", 2],
    ["/thinking/", ".thinking-people li", 2],
    ["/wiki/", ".wiki-rows li", 11],
    ["/projects/", ".project-card", 1],
  ] as const) {
    await open(page, path);
    await expect(page.locator("#swup-container")).toBeVisible();
    if (path !== "/projects/") await expect(page.locator(selector)).toHaveCount(count);
    else await expect(page.locator("#swup-container")).toContainText("PAN LOG");
  }
});

test("book search filters local entries", async ({ page }) => {
  await open(page, "/books/");
  await expect(page.locator(".book-card:visible")).toHaveCount(3);
  await page.locator("#books-search").fill("Hofstadter");
  await expect(page.locator(".book-card:visible")).toHaveCount(1);
  await page.locator("#books-search").fill("");
  await expect(page.locator(".book-card:visible")).toHaveCount(3);
});

test("display settings change the actual list layout and remember it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  await page.locator("#display-settings-switch").click();
  await page.locator("#display-setting").getByText("网格", { exact: true }).click();
  await expect(page.locator("#post-list")).toHaveAttribute("data-layout-mode", "grid");
  await expect.poll(() => page.locator("#post-list").evaluate(el => getComputedStyle(el).display)).toBe("grid");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#post-list")).toHaveAttribute("data-layout-mode", "grid");
});
