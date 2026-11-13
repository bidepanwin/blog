import assert from "node:assert/strict";
import test from "node:test";
import {
	postCoverAssignments,
	postCoverLibrary,
} from "../src/data/post-covers.ts";
import { validatePostCoverLibrary } from "../src/utils/post-covers.ts";

const expectedPosts = [
	"2026-10-17-hello",
	"2026-10-18-animaeva-memory-eval",
	"2026-10-18-careeratlas",
	"2026-10-18-frontier-report",
	"2026-10-18-olympia",
	"2026-10-18-seeker-learning-region-market",
	"2026-10-19-dsh-dotclaude",
	"2026-10-25-shardseek",
	"2026-11-02-blog-as-graph",
	"2026-11-06-diting",
];

test("curated library contains 16 traceable unique covers", () => {
	assert.equal(postCoverLibrary.length, 16);
	assert.equal(new Set(postCoverLibrary.map((cover) => cover.id)).size, 16);
	validatePostCoverLibrary(postCoverLibrary);
	for (const cover of postCoverLibrary)
		assert.equal(cover.file, `${cover.id}.webp`);
});

test("all ten current posts have distinct explicit assignments", () => {
	for (const postId of expectedPosts)
		assert.ok(postCoverAssignments[postId], postId);
	assert.equal(new Set(Object.values(postCoverAssignments)).size, 10);
	for (const coverId of Object.values(postCoverAssignments)) {
		assert.ok(
			postCoverLibrary.some((cover) => cover.id === coverId),
			coverId,
		);
	}
});
