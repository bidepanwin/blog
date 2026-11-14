import type { ProfileConfig } from "@/types/config";
import { withUserConfig } from "../utils/config-overlay.ts";

/** 博主资料：在此替换头像、名称、简介与社交链接。 */
export const profileConfig: ProfileConfig = withUserConfig("profile", {
	avatar: "/images/uploads/240721f5-f590-4985-9abf-92aaad5b151d.jpg",
	name: "bidepan",
	bio: "do and win · 把好奇心做成项目，把探索留在 PAN LOG。",
	links: [
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/bidepanwin",
		},
		{
			name: "RSS 订阅",
			icon: "material-symbols:rss-feed-rounded",
			url: "/rss.xml",
		},
	],
});
