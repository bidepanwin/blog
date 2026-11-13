/**
 * wiki-links：构建期扫描 content collections 的原始 Markdown，
 * 建立「双链图」——出链、反链、断链。对应 Karpathy LLM Wiki 的
 * index + backlinks 结构：结构由链接派生，而非目录层级。
 */
import { getCollection } from "astro:content";
import { getPostUrl, url } from "@utils/url-utils";

export interface WikiNode {
	id: string;
	title: string;
	url: string;
	kind: "thinking" | "post";
	school?: string;
}

export interface WikiGraph {
	nodes: Map<string, WikiNode>;
	/** targetId -> 引用它的 sourceId 列表（去重、保序） */
	backlinks: Map<string, string[]>;
	/** sourceId -> 它引用的 targetId 列表 */
	outlinks: Map<string, string[]>;
	/** 指向不存在页面的链接 */
	broken: Array<{ source: string; target: string }>;
}

const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]+?))?\]\]/g;
const MDLINK_RE = /\]\((\/(?:thinking|posts)\/[^)\s"]+)\)/g;

let cache: Promise<WikiGraph> | null = null;

function decodeSlug(raw: string): string {
	let s = raw.trim();
	try {
		s = decodeURIComponent(s);
	} catch {
		/* keep raw */
	}
	return s.replace(/\/+$/, "");
}

function slugFromUrl(
	url: string,
): { kind: "thinking" | "post"; slug: string } | null {
	const m = url.match(/^\/(thinking|posts)\/([^)#?]+)/);
	if (!m) return null;
	return {
		kind: m[1] === "thinking" ? "thinking" : "post",
		slug: decodeSlug(m[2]),
	};
}

function extractTargets(
	body: string,
): Array<{ kind?: "thinking" | "post"; slug: string; raw: string }> {
	const out: Array<{ kind?: "thinking" | "post"; slug: string; raw: string }> =
		[];
	const seen = new Set<string>();
	let m: RegExpExecArray | null;

	WIKILINK_RE.lastIndex = 0;
	while ((m = WIKILINK_RE.exec(body)) !== null) {
		const target = m[1].trim();
		if (!target) continue;
		const key = "w:" + target;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ slug: target, raw: target });
	}

	MDLINK_RE.lastIndex = 0;
	while ((m = MDLINK_RE.exec(body)) !== null) {
		const parsed = slugFromUrl(m[1]);
		if (!parsed) continue;
		const key = "m:" + parsed.kind + ":" + parsed.slug;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ kind: parsed.kind, slug: parsed.slug, raw: m[1] });
	}
	return out;
}

export async function buildWikiGraph(): Promise<WikiGraph> {
	if (cache) return cache;
	cache = (async () => {
		const nodes = new Map<string, WikiNode>();
		const sources: Array<{ id: string; body: string }> = [];

		const thinking = await getCollection("thinking");
		for (const e of thinking) {
			nodes.set(e.id, {
				id: e.id,
				title: e.data.title,
				url: url(`/thinking/${encodeURIComponent(e.id)}/`),
				kind: "thinking",
				school: e.data.school || "",
			});
			sources.push({ id: e.id, body: (e as { body?: string }).body ?? "" });
		}
		const posts = await getCollection("posts");
		for (const e of posts) {
			nodes.set(e.id, {
				id: e.id,
				title: e.data.title,
				url: getPostUrl(e),
				kind: "post",
			});
			sources.push({ id: e.id, body: (e as { body?: string }).body ?? "" });
		}

		// slug（忽略大小写）→ node id
		const bySlug = new Map<string, string>();
		for (const node of nodes.values()) {
			bySlug.set(node.id, node.id);
			bySlug.set(node.id.toLowerCase(), node.id);
		}

		const backlinks = new Map<string, string[]>();
		const outlinks = new Map<string, string[]>();
		const broken: Array<{ source: string; target: string }> = [];

		for (const { id, body } of sources) {
			const outs: string[] = [];
			for (const t of extractTargets(body)) {
				// 显式 kind 优先；否则 thinking 优先、posts 兜底
				const candidates: string[] = [];
				if (t.kind) candidates.push(t.slug, t.slug.toLowerCase());
				else {
					candidates.push(t.slug, t.slug.toLowerCase());
				}
				let resolved: string | undefined;
				for (const c of candidates) {
					if (bySlug.has(c)) {
						const nid = bySlug.get(c)!;
						if (t.kind && nodes.get(nid)?.kind !== t.kind) continue;
						resolved = nid;
						break;
					}
				}
				if (!resolved) {
					broken.push({ source: id, target: t.raw });
					continue;
				}
				if (resolved === id) continue; // 自链不计
				if (outs.includes(resolved)) continue;
				outs.push(resolved);
				if (!backlinks.has(resolved)) backlinks.set(resolved, []);
				const list = backlinks.get(resolved)!;
				if (!list.includes(id)) list.push(id);
			}
			outlinks.set(id, outs);
		}

		return { nodes, backlinks, outlinks, broken };
	})();
	return cache;
}

export async function getWikiConnections(id: string): Promise<{
	backlinks: WikiNode[];
	outlinks: WikiNode[];
}> {
	const graph = await buildWikiGraph();
	const resolve = (ids: string[] | undefined) =>
		(ids ?? [])
			.map((x) => graph.nodes.get(x))
			.filter((n): n is WikiNode => Boolean(n));
	return {
		backlinks: resolve(graph.backlinks.get(id)),
		outlinks: resolve(graph.outlinks.get(id)),
	};
}
