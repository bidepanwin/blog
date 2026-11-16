/**
 * 书单数据（本地手动维护条目 + scripts/books-sync.mjs 自动补图）。
 *
 * 添加条目：在 booksData 中追加一项即可，状态筛选 chips、题材筛选、计数自动生成。
 * - isbn 填上后，scripts/books-sync.mjs 会从 Open Library 拉封面存到
 *   public/assets/books/<slug>.jpg，并把 cover 字段写回本文件；
 *   也可以自己把封面放进 public/assets/books/ 并直接写 cover（同步脚本不会覆盖）。
 * - link 省略时用 douban 字段拼豆瓣搜索页；rating 为 0-10 个人评分（0 = 未评分）。
 * - status: reading 在读 / planned 想读 / completed 读过 / onHold 搁置。
 *
 * 当前书单主线：认知 → 实践 → 系统 → 范式 → 社会。
 * 封面取自对应豆瓣读书条目页并已转为本地 webp；douban 为核实过的真实条目 id。
 * 所有条目默认 planned + 未评分，阅读状态、评分与进度请按实际记录填写。
 */

export type BookStatus = "reading" | "planned" | "completed" | "onHold";

export interface BookItem {
	/** 稳定标识：用于封面文件名、链接锚点；省略则由标题 slug 化 */
	slug?: string;
	title: string;
	/** 原名（外文书原名/副标题），展示在标题下方 */
	originalTitle?: string;
	author?: string;
	/** ISBN-13（无横线亦可），用于自动取封面与元数据 */
	isbn?: string;
	/** Open Library 封面 id，仅在 ISBN 无图时作为兜底 */
	coverId?: string;
	/** 封面图地址（相对 /public 或绝对 URL）；省略 = 渐变占位 */
	cover?: string;
	/** 条目外链；省略时用 douban 拼豆瓣搜索，都没有则封面不可点 */
	link?: string;
	/** 豆瓣条目 id 或完整搜索关键词，如 "25862578" 或 "Gödel Escher Bach" */
	douban?: string;
	status: BookStatus;
	/** 个人评分 0-10（0 = 未评分） */
	rating: number;
	/** 一句话感想 */
	description?: string;
	/** 阅读年份（出版年请放 yearPublished） */
	year?: string;
	/** 出版年份 */
	yearPublished?: string;
	/** 题材标签 */
	genres: string[];
	/** 在读进度 0-100（仅 reading 状态显示进度条） */
	progress?: number;
	/** 是否置顶（在读书单会排在最前） */
	featured?: boolean;
	/** 添加到书单的日期（YYYY-MM-DD）；用于「按添加时间从近到远」排序 */
	addedAt?: string;
}

export const BOOK_STATUS_META: Record<
	BookStatus,
	{ label: string; labelZh: string }
> = {
	reading: { label: "Reading", labelZh: "在读" },
	completed: { label: "Completed", labelZh: "读过" },
	planned: { label: "Planned", labelZh: "想读" },
	onHold: { label: "On Hold", labelZh: "搁置" },
};

export const booksData: BookItem[] = [
	// —— 认知：先看清自己是怎么判断的 ——
	{
		slug: "thinking-fast-and-slow",
		title: "思考，快与慢",
		originalTitle: "Thinking, Fast and Slow",
		author: "Daniel Kahneman",
		isbn: "9787508633558",
		cover: "/assets/books/thinking-fast-and-slow.webp",
		link: "https://weread.qq.com/web/bookDetail/af83263058c217af81f8979",
		douban: "10785583",
		status: "planned",
		rating: 0,
		description:
			"系统 1 与系统 2：直觉替我们做了多少决定，又会在哪些地方系统性地出错。",
		yearPublished: "2012",
		genres: ["Psychology", "Decision"],
		addedAt: "2026-11-01",
	},
	// —— 实践：从调查到方法论 ——
	{
		slug: "selected-works-of-mao",
		title: "毛泽东选集",
		author: "毛泽东",
		cover: "/assets/books/selected-works-of-mao.webp",
		link: "https://weread.qq.com/web/reader/2bb32ff0813ab6ffcg014315",
		douban: "1139360",
		status: "planned",
		rating: 0,
		description:
			"人民出版社 1991 年第二版，按历史时期与写作年月编次，全四卷；封面为第一卷。",
		yearPublished: "1991",
		genres: ["History", "Methodology"],
		addedAt: "2026-11-02",
	},
	// —— 系统：把「头痛医头」换成看见结构 ——
	{
		slug: "thinking-in-systems",
		title: "系统之美",
		originalTitle: "Thinking in Systems: A Primer",
		author: "Donella H. Meadows",
		isbn: "9787213050114",
		cover: "/assets/books/thinking-in-systems.webp",
		link: "https://weread.qq.com/web/bookDetail/55b32da0813ab864cg017b6c",
		douban: "11528220",
		status: "planned",
		rating: 0,
		description:
			"存量、流量、反馈回路与延迟：复杂问题常常不是不够努力，而是没看见结构。",
		yearPublished: "2012",
		genres: ["Systems", "Decision"],
		addedAt: "2026-11-03",
	},
	// —— 范式：知识不是线性堆积 ——
	{
		slug: "structure-of-scientific-revolutions",
		title: "科学革命的结构",
		originalTitle: "The Structure of Scientific Revolutions",
		author: "Thomas S. Kuhn",
		isbn: "9787301330661",
		cover: "/assets/books/structure-of-scientific-revolutions.webp",
		link: "https://weread.qq.com/web/bookDetail/3ff32fb0813ab844ag01520f",
		douban: "35951747",
		status: "planned",
		rating: 0,
		description:
			"1962 年初版的经典：范式、常规科学与危机，解释一个学科为什么会整体换框架。",
		yearPublished: "2022",
		genres: ["Philosophy of Science"],
		addedAt: "2026-11-04",
	},
	// —— 社会：把概念放回它生长的土地 ——
	{
		slug: "from-the-soil",
		title: "乡土中国",
		author: "费孝通",
		cover: "/assets/books/from-the-soil.webp",
		link: "https://weread.qq.com/web/bookDetail/30d320b0813ab7120g018c2e",
		douban: "1795079",
		status: "planned",
		rating: 0,
		description:
			"差序格局、礼治秩序与乡土本色：四十年代讲义结集，理解中国基层社会的一组概念工具。",
		yearPublished: "2006",
		genres: ["Sociology", "China"],
		addedAt: "2026-11-05",
	},
	// —— 成长：十道羊皮卷的寓言 ——
	{
		slug: "the-greatest-salesman-in-the-world",
		title: "羊皮卷",
		originalTitle: "The Greatest Salesman in the World",
		author: "Og Mandino",
		cover: "/assets/books/the-greatest-salesman-in-the-world.webp",
		link: "https://weread.qq.com/web/bookDetail/ef332f007168d0deef31360",
		douban: "1083403",
		status: "planned",
		rating: 0,
		description:
			"牧童海菲得到十道神秘羊皮卷，遵循卷中原则执着创业：一部关于习惯、坚持与自我重塑的经典寓言。",
		yearPublished: "1968",
		genres: ["Motivation", "Growth"],
		addedAt: "2026-11-16",
	},
];

/** 取条目稳定 slug（与 scripts/books-sync.mjs 的规则保持一致） */
export function bookSlug(book: BookItem): string {
	if (book.slug) return book.slug;
	return book.title
		.toLowerCase()
		.replace(/[^a-z0-9一-龥]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

/** 条目外链优先级：link > 豆瓣 id/搜索 > 无 */
export function bookLink(book: BookItem): string | undefined {
	if (book.link) return book.link;
	if (book.douban) {
		return /^\d+$/.test(book.douban)
			? `https://book.douban.com/subject/${book.douban}/`
			: `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(book.douban)}`;
	}
	return undefined;
}

export function getBooksList(): BookItem[] {
	return booksData;
}
