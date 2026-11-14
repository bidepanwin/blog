import type { AboutConfig } from "../types/aboutConfig.ts";
import { withUserConfig } from "../utils/config-overlay.ts";

export const aboutConfig: AboutConfig = withUserConfig("about", {
	enable: true,
	title: "关于 bidepan",
	description: "把好奇心做成项目，把探索留在 PAN LOG。",
});
