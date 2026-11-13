import { expect, test } from "@playwright/test";
import { sitePath } from "./paths";

test("sample album lists four local photos and opens a preview", async ({ page }) => {
  await page.goto(sitePath("/albums/weekend/"), { waitUntil: "networkidle" });
  await expect(page.locator(".album-detail__header")).toContainText("山野与日常");
  await expect(page.locator(".album-detail__meta")).toContainText("周末散步");
  await expect(page.locator(".album-gallery__item")).toHaveCount(4);
  const photos = page.locator(".album-gallery__item img");
  await expect(photos).toHaveCount(4);
  await expect.poll(async () => photos.first().evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator(".album-gallery__item").first().click();
  await expect(page.locator(".fancybox__container")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fancybox__container")).not.toBeVisible();
});
