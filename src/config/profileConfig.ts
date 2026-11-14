import type { ProfileConfig } from "@/types/config";
import { withUserConfig } from "../utils/config-overlay.ts";

/** 博主资料：在此替换头像、名称、简介与社交链接。 */
export const profileConfig: ProfileConfig = withUserConfig("profile", {
	avatar: "assets/images/banner/mobile/8.webp",
	name: "bidepan",
	bio: "写代码，也写生活。在这里，收集每一个值得记录的瞬间。",
	links: [
		{
			name: "RSS 订阅",
			icon: "material-symbols:rss-feed-rounded",
			url: "/rss.xml",
		},
	],
});
