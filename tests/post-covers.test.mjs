import assert from "node:assert/strict";
import test from "node:test";
import {
	hashPostId,
	resolvePostCover,
	validatePostCoverAssignments,
	validatePostCoverLibrary,
} from "../src/utils/post-covers.ts";

const cover = (id) => ({
	id,
	file: `${id}.webp`,
	alt: `${id} illustration`,
	themes: ["AI"],
	sourceSite: "Example",
	sourceUrl: `https://example.com/${id}`,
	author: "Verified artist",
	authorization: "Permission status recorded from the source page",
});
const library = [cover("beta"), cover("alpha")];

test("FNV-1a hash is stable", () => {
	assert.equal(hashPostId("hello"), 0x4f9f2cab);
	assert.equal(hashPostId("hello"), hashPostId("hello"));
});

test("manual frontmatter wins over every fallback", () => {
	assert.equal(
		resolvePostCover("post", "custom.webp", library, { post: "alpha" }),
		"custom.webp",
	);
});

test("explicit assignment returns the content-relative asset path", () => {
	assert.equal(
		resolvePostCover("post", "", library, { post: "alpha" }),
		"../../assets/images/post-covers/alpha.webp",
	);
});

test("fallback uses stable IDs rather than array order", () => {
	assert.equal(
		resolvePostCover("hello", "", library, {}),
		"../../assets/images/post-covers/beta.webp",
	);
});

test("library rejects duplicate IDs and unsafe file names", () => {
	assert.throws(
		() => validatePostCoverLibrary([cover("same"), cover("same")]),
		/duplicate/,
	);
	assert.throws(
		() => validatePostCoverLibrary([{ ...cover("bad"), file: "../bad.webp" }]),
		/file/,
	);
	assert.throws(() => validatePostCoverLibrary([]), /empty/);
});

test("assignment validation rejects stale, unknown, and duplicate mappings", () => {
	assert.throws(
		() => validatePostCoverAssignments(["post"], library, { stale: "alpha" }),
		/stale/,
	);
	assert.throws(
		() => validatePostCoverAssignments(["post"], library, { post: "missing" }),
		/missing/,
	);
	assert.throws(
		() =>
			validatePostCoverAssignments(["a", "b"], library, {
				a: "alpha",
				b: "alpha",
			}),
		/duplicate/,
	);
});
