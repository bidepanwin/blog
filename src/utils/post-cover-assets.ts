import type { PostCover } from "@/types/postCovers";

const sourceAssets = import.meta.glob(
	"../assets/images/post-covers/*.{png,jpg,jpeg,webp,avif}",
	{ import: "default" },
);
const projectAssets = import.meta.glob(
	"/shirones/assets/images/post-covers/*.{png,jpg,jpeg,webp,avif}",
	{ import: "default" },
);

export function assertPostCoverAssets(library: PostCover[]): void {
	for (const cover of library) {
		const sourceKey = `../assets/images/post-covers/${cover.file}`;
		const projectKey = `/shirones/assets/images/post-covers/${cover.file}`;
		if (!(sourceKey in sourceAssets) && !(projectKey in projectAssets)) {
			throw new Error(`Post cover asset is missing: ${cover.file}`);
		}
	}
}
