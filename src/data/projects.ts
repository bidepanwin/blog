import type { ProjectItem } from "@/types/projectsConfig";

/**
 * 项目页内容数据：标题、描述、链接与阶段。
 * 前四项与 about 页「我在探索什么」中的公开仓库一一对应。
 * 可在本地管理台「收藏与数据 → 项目」中可视化维护。
 */
export const projectsData: ProjectItem[] = [
	{
		key: "pan-log",
		title: "PAN LOG",
		summary:
			"一个记录技术、生活与阅读的个人博客，基于 Astro 与 Shirone，持续探索舒服的阅读体验。",
		category: "lab",
		phase: "building",
		technologies: ["Astro", "TypeScript", "Svelte"],
		icon: "material-symbols:eco-outline-rounded",
		year: "2026",
		website: "https://bidepanwin.github.io/blog/",
	},
	{
		key: "chaos-atlas",
		title: "Chaos Atlas",
		summary:
			"把混沌系统、流场与粒子生命做成交互场景，探索数学、运动与生成艺术的视觉表达。",
		category: "visual",
		phase: "shipped",
		technologies: ["JavaScript", "Canvas", "生成艺术"],
		icon: "material-symbols:auto-awesome-outline-rounded",
		repository: "https://github.com/bidepanwin/chaos-atlas",
	},
	{
		key: "solar-terms-wheel",
		title: "廿四 · 节气之轮",
		summary:
			"用原生 HTML、CSS、JavaScript 和 Canvas，把二十四节气呈现为可以拖动的罗盘，让颜色与天象粒子随节气变化。",
		category: "visual",
		phase: "shipped",
		technologies: ["HTML", "CSS", "JavaScript", "Canvas"],
		icon: "material-symbols:explore-rounded",
		repository: "https://github.com/bidepanwin/solar-terms-wheel",
	},
	{
		key: "citytravel",
		title: "城市周末旅行指南",
		summary:
			"围绕城市周边出行整理目的地、筛选、行程与地图，尝试把信息组织成便于浏览的页面。",
		category: "web",
		phase: "shipped",
		technologies: ["HTML", "CSS", "JavaScript", "地图"],
		icon: "material-symbols:deployed-code-outline-rounded",
		repository: "https://github.com/bidepanwin/citytravel",
	},
	{
		key: "financial-rag",
		title: "Financial-RAG",
		summary:
			"探索金融资料与长文档的知识库管理、检索和问答，关心如何让回答关联到可查阅的来源。",
		category: "ai",
		phase: "exploring",
		technologies: ["RAG", "知识库", "检索问答"],
		icon: "material-symbols:menu-book-outline-rounded",
		repository: "https://github.com/bidepanwin/Financial-RAG",
	},
];
