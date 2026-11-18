import { siteConfig } from "../config/siteConfig.ts";
import {
	isExternalHref,
	mergeExternalRel,
	siteHosts,
} from "./external-link.mjs";

const BOUND_KEY = "externalLinksBound";

/**
 * 浏览器兜底：补齐构建期 rehype 插件覆盖不到的外部链接。
 *
 * 覆盖三类来源：`set:html` 注入的报告 HTML、Svelte 客户端动态插入的链接、
 * Swup 切页后新容器内的链接。判定规则复用 `src/utils/external-link.mjs`，
 * 与构建期保持一致；幂等、无网络请求、不改站内链接。
 */
export function bindExternalLinks() {
	if (window[BOUND_KEY]) return;
	window[BOUND_KEY] = true;

	const internalHosts = [
		...siteHosts(siteConfig.site ?? ""),
		window.location.host.toLowerCase(),
		window.location.hostname.toLowerCase(),
	];

	function ensure(anchor) {
		if (!(anchor instanceof HTMLAnchorElement)) return;
		// 下载链接与作者显式指定的非新窗口 target 保持原样。
		if (anchor.hasAttribute("download")) return;
		if (!isExternalHref(anchor.getAttribute("href"), internalHosts)) return;
		if (!anchor.target) anchor.target = "_blank";
		if (anchor.target !== "_blank") return;
		// 组件里已写死 target="_blank" 的链接（如 rel="me"）也补齐安全 rel。
		anchor.setAttribute(
			"rel",
			mergeExternalRel(anchor.getAttribute("rel")).join(" "),
		);
	}

	function scan(root) {
		if (!root) return;
		if (root instanceof HTMLAnchorElement) ensure(root);
		if (typeof root.querySelectorAll === "function")
			for (const anchor of root.querySelectorAll("a[href]")) ensure(anchor);
	}

	scan(document);
	document.addEventListener("swup:content:replace", () => scan(document));
	document.addEventListener("swup:page:view", () => scan(document));

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") {
				ensure(record.target);
				continue;
			}
			for (const added of record.addedNodes)
				if (added instanceof Element) scan(added);
		}
	});
	const observe = () => {
		if (!document.body) return;
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["href"],
		});
	};
	if (document.body) observe();
	else document.addEventListener("DOMContentLoaded", observe, { once: true });
}
