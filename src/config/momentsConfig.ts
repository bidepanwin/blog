import type { MomentsConfig } from "../types/momentsConfig.ts";
import { withUserConfig } from "../utils/config-overlay.ts";

export const momentsConfig: MomentsConfig = withUserConfig("moments", {
	enable: true,
	title: "随记",
	description: "不必等到长篇大论，微小的日常也值得被记住。",
});
