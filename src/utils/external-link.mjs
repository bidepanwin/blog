/**
 * 外部链接判定的单一事实来源。
 *
 * 构建期 `rehypeExternalLinks` 与浏览器 `bindExternalLinks` 共用这里的规则：
 * 只有 http(s) 绝对地址 / 协议相对地址、且 host 不属于本站的链接才算外部。
 * 相对地址、锚点、mailto/tel/data 等非网页协议保持原样。
 */

export const EXTERNAL_REL = ["noopener", "noreferrer"];

/**
 * 从 siteConfig.site 提取视为站内的 host（同时保留带端口与不带端口两种写法）。
 * @param {string} site
 * @returns {string[]}
 */
export function siteHosts(site = "") {
	if (!site) return [];
	try {
		const { host, hostname } = new URL(site);
		return [host.toLowerCase(), hostname.toLowerCase()].filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * @param {unknown} href
 * @param {string[]} internalHosts
 * @returns {boolean}
 */
export function isExternalHref(href, internalHosts = []) {
	if (typeof href !== "string") return false;
	const value = href.trim();
	if (!value || !/^(?:https?:)?\/\//i.test(value)) return false;
	try {
		const url = new URL(value, "https://site.invalid");
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		const host = url.host.toLowerCase();
		const hostname = url.hostname.toLowerCase();
		return !internalHosts.some((entry) => {
			const candidate = String(entry).toLowerCase();
			return candidate === host || candidate === hostname;
		});
	} catch {
		return false;
	}
}

/**
 * 合并已有 rel 与安全 rel，保留 nofollow / me / nofollow 等既有语义。
 * @param {unknown} existing
 * @returns {string[]}
 */
export function mergeExternalRel(existing) {
	let values = [];
	if (Array.isArray(existing)) values = existing;
	else if (typeof existing === "string") values = existing.split(/\s+/u);
	return [
		...new Set(
			[...values, ...EXTERNAL_REL]
				.map((item) => String(item).trim().toLowerCase())
				.filter(Boolean),
		),
	];
}
