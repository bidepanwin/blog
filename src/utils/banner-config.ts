import type {
	BannerConfig,
	BannerSourceValue,
	BannerThemeSource,
} from "@/types/config";
import type { SidebarPage } from "@/types/sidebarConfig";

interface BannerSourceSelection {
	desktop: BannerSourceValue;
	mobile: BannerSourceValue;
	dimOpacity: number;
	dimLightScale: number;
}

export function selectBannerSources(
	banner: BannerConfig,
	page?: SidebarPage,
): BannerSourceSelection {
	const configured = page ? banner.pageImages?.[page] : undefined;
	return {
		desktop: configured?.desktop ?? banner.src.desktop,
		mobile: configured?.mobile ?? configured?.desktop ?? banner.src.mobile,
		dimOpacity: Math.min(
			Math.max(configured?.dimOpacity ?? banner.dim.opacity, 0),
			1,
		),
		// Existing global light-theme dimming is softer; explicit page overrides
		// represent the actual opacity so bright photos remain readable.
		dimLightScale: configured?.dimOpacity === undefined ? 0.55 : 1,
	};
}

export function normalizeBannerSource(
	source: BannerSourceValue,
): BannerThemeSource {
	if (Array.isArray(source)) return { light: source, dark: source };
	return { light: source.light, dark: source.dark };
}
