import type { TrackDescriptor } from "@/types/musicConfig";

/**
 * 侧栏音乐本地曲目数据源。
 * 遵循「零额外负担」原则：配置与数据解耦，此处专用于管理本地曲目列表。
 *
 * 添加曲目：在 musicTracks 中追加一项即可：
 * - id: 唯一标识
 * - title: 曲目标题
 * - artist: 艺术家（可选）
 * - cover: 封面图地址（可选；推荐相对 /src，亦支持 /public 或绝对 URL）
 * - source: 音频文件地址（相对 /public 或绝对 URL）
 * - duration: 曲目时长（秒，可选）
 */
export const musicTracks: readonly TrackDescriptor[] = [
	{
		id: "qingtian",
		title: "晴天",
		artist: "周杰伦",
		cover: "assets/images/music/qingtian.webp",
		source: "/assets/music/url/qingtian.mp3",
		duration: 269,
	},
	{
		id: "qilixiang",
		title: "七里香",
		artist: "周杰伦",
		cover: "assets/images/music/qilixiang.webp",
		source: "/assets/music/url/qilixiang.mp3",
		duration: 299,
	},
	{
		id: "qinghuaci",
		title: "青花瓷",
		artist: "周杰伦",
		cover: "assets/images/music/qinghuaci.webp",
		source: "/assets/music/url/qinghuaci.mp3",
		duration: 239,
	},
	{
		id: "yequ",
		title: "夜曲",
		artist: "周杰伦",
		cover: "assets/images/music/yequ.webp",
		source: "/assets/music/url/yequ.mp3",
		duration: 227,
	},
	{
		id: "lanting-xu",
		title: "兰亭序",
		artist: "周杰伦",
		cover: "assets/images/music/lanting-xu.webp",
		source: "/assets/music/url/lanting-xu.mp3",
		duration: 255,
	},
	{
		id: "daoxiang",
		title: "稻香",
		artist: "周杰伦",
		cover: "assets/images/music/daoxiang.webp",
		source: "/assets/music/url/daoxiang.mp3",
		duration: 224,
	},
	{
		id: "gaobai-qiqiu",
		title: "告白气球",
		artist: "周杰伦",
		cover: "assets/images/music/gaobai-qiqiu.webp",
		source: "/assets/music/url/gaobai-qiqiu.m4a",
		duration: 223,
	},
	{
		id: "yilu-xiangbei",
		title: "一路向北",
		artist: "周杰伦",
		cover: "assets/images/music/yilu-xiangbei.webp",
		source: "/assets/music/url/yilu-xiangbei.mp3",
		duration: 295,
	},
	{
		id: "ai-zai-xiyuanqian",
		title: "爱在西元前",
		artist: "周杰伦",
		cover: "assets/images/music/ai-zai-xiyuanqian.webp",
		source: "/assets/music/url/ai-zai-xiyuanqian.mp3",
		duration: 235,
	},
	{
		id: "geqian",
		title: "搁浅",
		artist: "周杰伦",
		cover: "assets/images/music/geqian.webp",
		source: "/assets/music/url/geqian.mp3",
		duration: 241,
	},
	{
		id: "hongchen-kezhan",
		title: "红尘客栈",
		artist: "周杰伦",
		cover: "assets/images/music/hongchen-kezhan.webp",
		source: "/assets/music/url/hongchen-kezhan.mp3",
		duration: 275,
	},
	{
		id: "feng",
		title: "枫",
		artist: "周杰伦",
		cover: "assets/images/music/feng.webp",
		source: "/assets/music/url/feng.mp3",
		duration: 276,
	},
	{
		id: "bandao-tiehe",
		title: "半岛铁盒",
		artist: "周杰伦",
		cover: "assets/images/music/bandao-tiehe.webp",
		source: "/assets/music/url/bandao-tiehe.m4a",
		duration: 292,
	},
	{
		id: "fanfangxiang-de-zhong",
		title: "反方向的钟",
		artist: "周杰伦",
		cover: "assets/images/music/fanfangxiang-de-zhong.webp",
		source: "/assets/music/url/fanfangxiang-de-zhong.mp3",
		duration: 259,
	},
	{
		id: "huahai",
		title: "花海",
		artist: "周杰伦",
		cover: "assets/images/music/huahai.webp",
		source: "/assets/music/url/huahai.mp3",
		duration: 265,
	},
];
