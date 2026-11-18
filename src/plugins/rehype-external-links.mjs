import {
	isExternalHref,
	mergeExternalRel,
	siteHosts,
} from "../utils/external-link.mjs";

/**
 * Rehype：为 Markdown 正文及组件输出的外部链接补 target / rel。
 *
 * 读取节点：`element` 上的 `a[href]`；写入属性：`target`、`rel`。
 * 顺序依赖：晚于 `rehypeComponents`（覆盖 directive 组件生成的链接），
 * 早于 `rehypeBasePath`（后者只改写根相对地址，须保持链末端）。
 * 已有 target、带 download 属性、站内绝对地址与非网页协议一律保持原样。
 *
 * @param {{ site?: string }} options
 */
export function rehypeExternalLinks({ site = "" } = {}) {
	const internalHosts = siteHosts(site);

	function visit(node) {
		if (node?.type === "element" && node.tagName === "a" && node.properties) {
			const properties = node.properties;
			if (
				properties.target == null &&
				!("download" in properties) &&
				isExternalHref(properties.href, internalHosts)
			) {
				properties.target = "_blank";
				properties.rel = mergeExternalRel(properties.rel);
			}
		}
		for (const child of node?.children ?? []) visit(child);
	}

	return (tree) => visit(tree);
}
