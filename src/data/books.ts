/**
 * 书单数据（本地手动维护条目 + scripts/books-sync.mjs 自动补图）。
 *
 * 添加条目：在 booksData 中追加一项即可，状态筛选 chips、题材筛选、计数自动生成。
 * - isbn 填上后，scripts/books-sync.mjs 会从 Open Library 拉封面存到
 *   public/assets/books/<slug>.jpg，并把 cover 字段写回本文件；
 *   也可以自己把封面放进 public/assets/books/ 并直接写 cover（同步脚本不会覆盖）。
 * - link 省略时用 douban 字段拼豆瓣搜索页；rating 为 0-10 个人评分（0 = 未评分）。
 * - status: reading 在读 / planned 想读 / completed 读过 / onHold 搁置。
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
	// —— 在读 ——
	{
		slug: "geb",
		title: "Gödel, Escher, Bach: An Eternal Golden Braid",
		originalTitle: "集异璧之大成",
		author: "Douglas R. Hofstadter",
		cover: "/assets/books/geb.jpg",
		isbn: "9780465026562",
		douban: "Gödel Escher Bach 集异璧",
		status: "reading",
		rating: 0,
		progress: 35,
		description:
			"自指、递归与意识的怪圈。从不同领域理解自指与思维，是一份值得慢慢读的书单示例。",
		yearPublished: "1979",
		genres: ["Math", "Cognition"],
		featured: true,
	},
	// —— 想读 ——
	{
		slug: "consciousness-explained",
		title: "Consciousness Explained",
		originalTitle: "意识的解释",
		author: "Daniel C. Dennett",
		cover: "/assets/books/consciousness-explained.jpg",
		isbn: "9780316180665",
		coverId: "3964666",
		douban: "Consciousness Explained 意识的解释",
		status: "planned",
		rating: 0,
		yearPublished: "1991",
		genres: ["Philosophy of Mind"],
	},
	{
		slug: "feeling-of-what-happens",
		title: "The Feeling of What Happens",
		originalTitle: "感受发生的一切",
		author: "Antonio Damasio",
		cover: "/assets/books/feeling-of-what-happens.jpg",
		isbn: "9780156010757",
		douban: "The Feeling of What Happens 感受发生的一切",
		status: "planned",
		rating: 0,
		yearPublished: "1999",
		genres: ["Neuroscience"],
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
