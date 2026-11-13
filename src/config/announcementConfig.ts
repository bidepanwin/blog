import type { AnnouncementConfig } from "@/types/announcementConfig";
import { withUserConfig } from "../utils/config-overlay.ts";

export const announcementConfig: AnnouncementConfig = withUserConfig(
	"announcement",
	{
		title: "你好，欢迎来到我的博客",
		content: "这里记录技术、阅读和生活。新文章持续更新，欢迎常来看看。",
		closable: true,
		link: { enable: true, text: "认识一下", url: "/about/", external: false },
	},
);
