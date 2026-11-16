/**
 * 番剧收藏数据（本地数据源）。
 * 用于番剧页：src/pages/anime.astro → organisms/AnimeSection → molecules/AnimeCard。
 *
 * 添加条目：在 animeData 中追加一项即可，状态筛选 chips 与计数自动生成。
 * - cover 省略时卡片显示主题色渐变占位（补图前不破版）；
 * - link 省略时封面不可点；rating 为 0-10 个人评分；
 * - progress 是结构化追番进度，watching 状态在卡片上渲染进度条。
 * JSON 数据源（外部收藏服务拉取）见 utils/anime-data.ts 的 AnimeSource 分发。
 *
 * 当前选片主线：技术 / 社会 / 人心 / 时间 —— 每部都留一个可以想很久的问题。
 * 封面取自对应豆瓣电影条目页并已转为本地 webp，link 指向该条目；
 * 新条目默认 planned + 未评分，观看状态、评分与进度请按实际记录填写。
 */

import type { AnimeIdentity } from "../types/animeConfig.ts";

/** 收藏状态（Bangumi 领域通行五态） */
export type AnimeStatus =
	| "watching"
	| "completed"
	| "planned"
	| "onHold"
	| "dropped";

export interface AnimeItem {
	title: string;
	/** 封面图地址（相对 /public 或绝对 URL）；省略 = 渐变占位 */
	cover?: string;
	/** 条目外链（Bangumi/官方站等）；省略则封面不可点 */
	link?: string;
	status: AnimeStatus;
	/** 个人评分 0-10 */
	rating: number;
	/** 追番进度：已看 / 总集数（未知时可选省略） */
	progress?: { watched: number; total: number };
	/** 一句话感想 */
	description?: string;
	/** 放送年份（展示用） */
	year: string;
	/** 制作公司 */
	studio?: string;
	/** 题材标签 */
	genres: string[];
	/** 观看时间段（年-月） */
	period?: { start: string; end: string };
	/** 条目来源身份标识（可选，用于跨源去重与归档） */
	identity?: AnimeIdentity;
	/** 添加到收藏的日期（YYYY-MM-DD）；用于「按添加时间从近到远」排序 */
	addedAt?: string;
}

export const animeData: AnimeItem[] = [
	// 技术：义体化之后，什么还能证明「我」是「我」
	{
		title: "攻壳机动队 S.A.C.",
		cover: "/assets/anime/ghost-in-the-shell-sac.webp",
		link: "https://movie.douban.com/subject/1431615/",
		status: "planned",
		rating: 0,
		description:
			"电子脑、笑脸男与 Stand Alone Complex：记忆可被改写时，个体与集体如何互相制造。",
		year: "2002",
		studio: "Production I.G",
		genres: ["Cyberpunk", "Sci-Fi", "Philosophy"],
		addedAt: "2026-11-01",
	},
	// 技术：当机器会悲伤，权利与仇恨该怎么算
	{
		title: "冥王 PLUTO",
		cover: "/assets/anime/pluto.webp",
		link: "https://movie.douban.com/subject/27069431/",
		status: "planned",
		rating: 0,
		description:
			"浦泽直树重述手冢治虫：一桩机器人连环命案，把战争创伤与「何以为人」摆上桌面。",
		year: "2023",
		studio: "Studio M2",
		genres: ["Sci-Fi", "Mystery", "Ethics"],
		addedAt: "2026-11-02",
	},
	// 社会：秩序的代价，往往由不被计入的人支付
	{
		title: "来自新世界",
		cover: "/assets/anime/from-the-new-world.webp",
		link: "https://movie.douban.com/subject/10527275/",
		status: "planned",
		rating: 0,
		description:
			"一个被精心设计的稳定社会，把伦理问题藏进教科书与童年里，直到无人再提问。",
		year: "2012",
		studio: "A-1 Pictures",
		genres: ["Sci-Fi", "Drama", "Dystopia"],
		addedAt: "2026-11-03",
	},
	// 人心：被照顾，也是一种需要重新学习的能力
	{
		title: "3月的狮子",
		cover: "/assets/anime/march-comes-in-like-a-lion.webp",
		link: "https://movie.douban.com/subject/26615510/",
		status: "planned",
		rating: 0,
		description:
			"孤独的将棋棋士与川本三姐妹：关于丧失、霸凌，以及人怎样慢慢学会依赖别人。",
		year: "2016",
		studio: "SHAFT",
		genres: ["Drama", "Slice of Life"],
		addedAt: "2026-11-04",
	},
	// 时间：把「之后」当作正题来写
	{
		title: "葬送的芙莉莲",
		cover: "/assets/anime/frieren.webp",
		link: "https://movie.douban.com/subject/36093351/",
		status: "completed",
		rating: 9.5,
		progress: { watched: 28, total: 28 },
		description:
			"勇者一行之后，魔法使漫长的余生：以近乎静止的时间尺度重新丈量记忆与告别。",
		year: "2023",
		studio: "Madhouse",
		genres: ["Fantasy", "Adventure"],
		period: { start: "2023-09", end: "2024-03" },
		addedAt: "2026-11-05",
	},
	// 正在追：国创年番，韩立稳健修仙路
	{
		title: "凡人修仙传",
		cover: "/assets/anime/fanren-xiuxian-zhuan.webp",
		link: "https://www.bilibili.com/bangumi/play/ss28747",
		status: "watching",
		rating: 0,
		description:
			"看机智的凡人小子韩立如何稳健发展、步步为营，战魔道、夺至宝、驰骋星海，成为纵横三界的强者。",
		year: "2020",
		studio: "万维猫动画 / 原力动画",
		genres: ["玄幻", "热血", "励志"],
		addedAt: "2026-11-15",
	},
];
