/**
 * 友情链接数据配置（结构与 Mizuki 同款，便于互相迁移）。
 * 用于管理友情链接页面的数据：src/pages/friends.astro → organisms/FriendSection。
 *
 * 添加友链：在 friendsData 中追加一项即可，页面 / 筛选标签自动生成。
 * tags 会聚合为页面顶部的筛选 chip（OR 命中：选中多个标签时命中任一即显示）。
 */
export interface FriendItem {
	id: number;
	title: string;
	imgurl: string;
	desc: string;
	siteurl: string;
	tags: string[];
}

// 友情链接数据
// 迁移时清空了 Shirone 主题自带的演示友链（Mizuki / Astro / Material 3）。
// 申请互链说明见 src/content/spec/friends.md；有真实友链后在此追加。
export const friendsData: FriendItem[] = [
	{
		id: 1,
		title: "Shirone",
		imgurl: "/logo/icon.webp",
		desc: "本站使用的开源博客主题，基于 Astro 与 Svelte。",
		siteurl: "https://github.com/LyraVoid/Shirone",
		tags: ["AI", "技术"],
	},
	{
		id: 2,
		title: "Terence Tao · What's new",
		imgurl: "/assets/friends/tao.jpg",
		desc: "陶哲轩的数学博客：研究进展、公开问题与数学随笔。",
		siteurl: "https://terrytao.wordpress.com/",
		tags: ["数学"],
	},
	{
		id: 3,
		title: "Astro",
		imgurl: "/assets/friends/astro.svg",
		desc: "本站的建站框架。为内容站点而生的现代 Web 框架。",
		siteurl: "https://astro.build/",
		tags: ["技术", "工具"],
	},
];

// 获取所有友情链接数据（稳定顺序，测试可复现）
export function getFriendsList(): FriendItem[] {
	return friendsData;
}

// 获取随机排序的友情链接数据（避免固定排序，按需使用）
export function getShuffledFriendsList(): FriendItem[] {
	const shuffled = [...friendsData];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}
