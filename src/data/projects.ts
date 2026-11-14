import type { ProjectItem } from "@/types/projectsConfig";

/** 可选项目页的测试内容；启用前可在此替换成自己的作品。 */
export const projectsData: ProjectItem[] = [
	{
		key: "between-leaves",
		title: "PAN LOG",
		summary:
			"一个记录技术、生活与阅读的个人博客，基于 Astro 与 Shirone，持续探索舒服的阅读体验。",
		category: "lab",
		phase: "building",
		technologies: ["Astro", "TypeScript", "Svelte"],
		icon: "material-symbols:eco-outline-rounded",
		year: "2026",
	},
];
