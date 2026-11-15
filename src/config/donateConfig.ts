import { withUserConfig } from "../utils/config-overlay.ts";

/**
 * 赞赏（打赏）配置单一真源。
 *
 * 遵循「零额外负担」原则：默认关闭（enable: false）时不产生任何 DOM 与运行时开销。
 * 开启后，在文章末尾渲染一个「赞赏」按钮，点击弹出收款码（微信 / 支付宝）。
 *
 * 图片路径建议使用 public 目录下的绝对路径（以 "/" 开头），
 * 例如将二维码图片放到 public/images/donate/wechat.png 后填 "/images/donate/wechat.png"。
 */
export interface DonateConfig {
	/** 全局赞赏总开关 */
	enable: boolean;
	/** 弹窗标题（可留空，留空时用 i18n 文案） */
	title: string;
	/** 弹窗说明文字（可留空） */
	description: string;
	/** 微信赞赏码图片路径 */
	wechat: string;
	/** 支付宝赞赏码图片路径 */
	alipay: string;
}

export const donateConfig: DonateConfig = withUserConfig("donate", {
	enable: true,
	title: "",
	description: "",
	// 将你的收款码图片放入 public/images/donate/ 后，填入对应路径即可。
	wechat: "/images/donate/wechat.png",
	alipay: "/images/donate/alipay.jpg",
});
