import { getImage } from "astro:assets";
import type { BannerConfig, BannerThemeSource } from "@/types/config";
import type { SidebarPage } from "@/types/sidebarConfig";
import { resolveImageAsset } from "./asset-utils";
import { normalizeBannerSource, selectBannerSources } from "./banner-config";
import { url } from "./url-utils";

interface ResponsiveBannerImage {
	fallback: string;
	avifSrcset: string;
	webpSrcset: string;
	width?: number;
	height?: number;
}

export interface BannerMedia {
	desktopResponsive: {
		light: ResponsiveBannerImage[];
		dark: ResponsiveBannerImage[];
	};
	mobileResponsive: {
		light: ResponsiveBannerImage[];
		dark: ResponsiveBannerImage[];
	};
	payload: {
		desktop: BannerThemeSource;
		mobile: BannerThemeSource;
		dimOpacity: number;
		dimLightScale: number;
	};
}

const optimizationCache = new Map<string, Promise<ResponsiveBannerImage>>();

async function optimizeBannerImage(
	src: string,
	viewport: "desktop" | "mobile",
): Promise<ResponsiveBannerImage> {
	const resolved = await resolveImageAsset(src);
	if (typeof resolved === "string") {
		return {
			fallback: resolved.startsWith("/") ? url(resolved) : resolved,
			avifSrcset: "",
			webpSrcset: "",
		};
	}
	const requested =
		viewport === "desktop" ? [1280, 1600, 1920] : [640, 828, 1080];
	const widths = [
		...new Set([
			...requested.filter((width) => width <= resolved.width),
			Math.min(requested.at(-1) ?? resolved.width, resolved.width),
		]),
	].sort((a, b) => a - b);
	const candidates = (format: "avif" | "webp", quality: number) =>
		Promise.all(
			widths.map(async (width) => ({
				width,
				image: await getImage({ src: resolved, width, format, quality }),
			})),
		);
	const [avif, webp] = await Promise.all([
		candidates("avif", 55),
		candidates("webp", 68),
	]);
	return {
		fallback: webp.at(-1)?.image.src ?? resolved.src,
		avifSrcset: avif
			.map(({ image, width }) => `${image.src} ${width}w`)
			.join(", "),
		webpSrcset: webp
			.map(({ image, width }) => `${image.src} ${width}w`)
			.join(", "),
		width: resolved.width,
		height: resolved.height,
	};
}

/** Server-only: optimize and serialize only the current route's images. */
export async function createBannerMedia(
	banner: BannerConfig,
	page?: SidebarPage,
): Promise<BannerMedia> {
	const selected = selectBannerSources(banner, page);
	const optimizeGroup = async (viewport: "desktop" | "mobile") => {
		const source = normalizeBannerSource(selected[viewport]);
		const optimize = (src: string) => {
			const key = `${viewport}:${src}`;
			let result = optimizationCache.get(key);
			if (!result) {
				result = optimizeBannerImage(src, viewport);
				optimizationCache.set(key, result);
			}
			return result;
		};
		const [light, dark] = await Promise.all([
			Promise.all(source.light.map(optimize)),
			Promise.all(source.dark.map(optimize)),
		]);
		return { light, dark };
	};
	const [desktopResponsive, mobileResponsive] = await Promise.all([
		optimizeGroup("desktop"),
		optimizeGroup("mobile"),
	]);
	const paths = (group: typeof desktopResponsive) => ({
		light: group.light.map(({ fallback }) => fallback),
		dark: group.dark.map(({ fallback }) => fallback),
	});
	return {
		desktopResponsive,
		mobileResponsive,
		payload: {
			desktop: paths(desktopResponsive),
			mobile: paths(mobileResponsive),
			dimOpacity: selected.dimOpacity,
			dimLightScale: selected.dimLightScale,
		},
	};
}
