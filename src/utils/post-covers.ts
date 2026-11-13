import type { PostCover, PostCoverAssignments } from "@/types/postCovers";

const COVER_BASE = "../../assets/images/post-covers";
const SAFE_FILE = /^[a-z0-9][a-z0-9-]*\.webp$/;

export function hashPostId(value: string): number {
	let hash = 0x811c9dc5;
	for (const character of value) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function validatePostCoverLibrary(library: PostCover[]): void {
	if (library.length === 0) throw new Error("Post cover library is empty");
	const ids = new Set<string>();
	for (const cover of library) {
		if (ids.has(cover.id))
			throw new Error(`Post cover duplicate id: ${cover.id}`);
		ids.add(cover.id);
		if (!SAFE_FILE.test(cover.file))
			throw new Error(`Unsafe post cover file: ${cover.file}`);
		for (const field of [
			"alt",
			"sourceSite",
			"sourceUrl",
			"author",
			"authorization",
		] as const) {
			if (!cover[field].trim())
				throw new Error(`Post cover ${cover.id} has empty ${field}`);
		}
		const source = new URL(cover.sourceUrl);
		if (source.protocol !== "https:")
			throw new Error(`Post cover ${cover.id} needs an HTTPS source`);
	}
}

export function validatePostCoverAssignments(
	postIds: string[],
	library: PostCover[],
	assignments: PostCoverAssignments,
): void {
	validatePostCoverLibrary(library);
	const knownPosts = new Set(postIds);
	const knownCovers = new Set(library.map((cover) => cover.id));
	const used = new Map<string, string>();
	for (const [postId, coverId] of Object.entries(assignments)) {
		if (!knownPosts.has(postId))
			throw new Error(`Post cover assignment is stale: ${postId}`);
		if (!knownCovers.has(coverId))
			throw new Error(`Post cover ${coverId} is missing from the library`);
		const previous = used.get(coverId);
		if (previous)
			throw new Error(
				`Post cover duplicate assignment: ${previous} and ${postId} share ${coverId}`,
			);
		used.set(coverId, postId);
	}
}

export function resolvePostCover(
	postId: string,
	manualImage: string,
	library: PostCover[],
	assignments: PostCoverAssignments,
): string {
	if (manualImage.trim()) return manualImage;
	validatePostCoverLibrary(library);
	const assignedId = assignments[postId];
	if (assignedId) {
		const assigned = library.find((cover) => cover.id === assignedId);
		if (!assigned)
			throw new Error(`Post cover ${assignedId} is missing from the library`);
		return `${COVER_BASE}/${assigned.file}`;
	}
	const sorted = [...library].sort((a, b) => a.id.localeCompare(b.id));
	return `${COVER_BASE}/${sorted[hashPostId(postId) % sorted.length].file}`;
}
