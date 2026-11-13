import { siteConfig } from "../../src/config/siteConfig";

/** Exercise the same project subdirectory used by GitHub Pages. */
export function sitePath(path = "/") {
	return `${siteConfig.base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
