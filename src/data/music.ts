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
		id: "world-execute",
		title: "world.execute (me) ;",
		artist: "Mili",
		cover: "assets/images/music/world-execute.webp",
		source: "/assets/music/url/world-execute.mp3",
		duration: 212,
	},
	{
		id: "colorful-array",
		title: "Colorful Array",
		artist: "Neuro-sama / pb",
		cover: "assets/images/music/colorful-array.webp",
		source: "/assets/music/url/colorful-array.mp3",
		duration: 273,
	},
	{
		id: "pattern-recog",
		title: "Pattern Recognition (feat. ODDEEO)",
		artist: "Neuro-sama / ODDEEO",
		cover: "assets/images/music/pattern-recog.webp",
		source: "/assets/music/url/pattern-recog.mp3",
		duration: 287,
	},
	{
		id: "life",
		title: "Life (feat. Neuro-sama)",
		artist: "Misanthropist / Neuro-sama",
		cover: "assets/images/music/life.webp",
		source: "/assets/music/url/life.mp3",
		duration: 188,
	},
	{
		id: "boom",
		title: "BOOM",
		artist: "Evil Neuro",
		cover: "assets/images/music/boom.webp",
		source: "/assets/music/url/boom.mp3",
		duration: 205,
	},
	{
		id: "crazy-robot",
		title: "Crazy in' Robot Body",
		artist: "Evil Neuro",
		cover: "assets/images/music/crazy-robot.webp",
		source: "/assets/music/url/crazy-robot.mp3",
		duration: 172,
	},
	{
		id: "fanwutuobang",
		title: "反乌托邦",
		artist: "乌托邦P",
		cover: "assets/images/music/fanwutuobang.webp",
		source: "/assets/music/url/fanwutuobang.mp3",
		duration: 152,
	},
	{
		id: "sekai-to-iun",
		title: "それを世界と言うんだね (Chinese Ver.)",
		artist: "花譜",
		cover: "assets/images/music/sekai-to-iun.webp",
		source: "/assets/music/url/sekai-to-iun.mp3",
		duration: 239,
	},
	{
		id: "fanwutuobang2",
		title: "反乌托邦Pt.2",
		artist: "亞細亞曠世奇才 / 洛天依 / 乌托邦P",
		cover: "assets/images/music/fanwutuobang2.webp",
		source: "/assets/music/url/fanwutuobang2.mp3",
		duration: 179,
	},
	{
		id: "shinkai",
		title: "深海少女 -deep sea girl- (feat. 初音ミク)",
		artist: "ゆうゆ / 初音ミク",
		cover: "assets/images/music/shinkai.webp",
		source: "/assets/music/url/shinkai.mp3",
		duration: 222,
	},
	{
		id: "retto-aika",
		title: "劣等哀歌 (feat. 初音ミク & 重音テト)",
		artist: "MIMI / 初音ミク / 重音テト",
		cover: "assets/images/music/retto-aika.webp",
		source: "/assets/music/url/retto-aika.mp3",
		duration: 153,
	},
	{
		id: "feixue",
		title: "沸雪煮相思",
		artist: "Newbiao好梦一场 / 洛天依 / 星尘",
		cover: "assets/images/music/feixue.webp",
		source: "/assets/music/url/feixue.mp3",
		duration: 201,
	},
	{
		id: "mousou-hello",
		title: "妄想感傷代償連盟 -Hello ver.-",
		artist: "DECO*27",
		cover: "assets/images/music/mousou-hello.webp",
		source: "/assets/music/url/mousou-hello.mp3",
		duration: 259,
	},
	{
		id: "sora-ni-menjite",
		title: "空に免じて (feat. 初音ミク)",
		artist: "傘村トータ / 初音ミク",
		cover: "assets/images/music/sora-ni-menjite.webp",
		source: "/assets/music/url/sora-ni-menjite.mp3",
		duration: 273,
	},
	{
		id: "mousou-25ji",
		title: "妄想感傷代償連盟 (feat. 宵崎奏&東雲絵名&初音ミク)",
		artist: "25時、ナイトコードで。 / 初音ミク",
		cover: "assets/images/music/mousou-25ji.webp",
		source: "/assets/music/url/mousou-25ji.mp3",
		duration: 268,
	},
	{
		id: "kokushi",
		title: "告死鸟",
		artist: "ilem",
		cover: "assets/images/music/kokushi.webp",
		source: "/assets/music/url/kokushi.mp3",
		duration: 241,
	},
	{
		id: "chou-chou",
		title: "超超超计算机世纪",
		artist: "灼音Choir / 洛天依",
		cover: "assets/images/music/chou-chou.webp",
		source: "/assets/music/url/chou-chou.mp3",
		duration: 291,
	},
	{
		id: "never",
		title: "NEVER (feat. Evil Neuro)",
		artist: "Neuro-sama / Evil Neuro",
		cover: "assets/images/music/never.webp",
		source: "/assets/music/url/never.mp3",
		duration: 230,
	},
	{
		id: "dennou",
		title: "電脳",
		artist: "V.W.P",
		cover: "assets/images/music/dennou.webp",
		source: "/assets/music/url/dennou.mp3",
		duration: 238,
	},
];
