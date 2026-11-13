/**
 * Run after generated Markdown components and image enhancement. Only rewrite
 * root-relative HAST URLs; source Markdown stays portable for the wiki scanner.
 * This build-time step adds no browser code or syntax-specific resources.
 */
export function rehypeBasePath({ base = "/" } = {}) {
	const prefix = `/${base.split("/").filter(Boolean).join("/")}`;
	if (prefix === "/") return;

	function applyBase(value) {
		if (
			typeof value !== "string" ||
			!value.startsWith("/") ||
			value.startsWith("//") ||
			value === prefix ||
			value.startsWith(`${prefix}/`) ||
			value.startsWith(`${prefix}?`) ||
			value.startsWith(`${prefix}#`)
		)
			return value;
		return `${prefix}${value}`;
	}

	return (tree) => {
		function visit(node) {
			if (node.type === "element" && node.properties) {
				for (const key of ["href", "src", "poster"]) {
					if (key in node.properties)
						node.properties[key] = applyBase(node.properties[key]);
				}
			}
			for (const child of node.children ?? []) visit(child);
		}
		visit(tree);
	};
}
