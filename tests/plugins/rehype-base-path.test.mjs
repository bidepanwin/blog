import assert from "node:assert/strict";
import test from "node:test";
import { rehypeBasePath } from "../../src/plugins/rehype-base-path.mjs";

test("project Pages paths preserve portable Markdown and generated links", () => {
	const values = ["/about/", "/images/photo.webp", "/blog/posts/a/", "/blog?tag=a", "//cdn.example.com/a", "https://example.com/a", "#heading", "../next/"];
	const tree = { type: "root", children: values.map((href) => ({ type: "element", tagName: "a", properties: { href }, children: [] })) };
	rehypeBasePath({ base: "/blog/" })(tree);
	assert.deepEqual(tree.children.map((node) => node.properties.href), ["/blog/about/", "/blog/images/photo.webp", ...values.slice(2)]);
	const image = { type: "element", properties: { src: "/images/photo.webp", poster: "/images/poster.webp" } };
	rehypeBasePath({ base: "/blog/" })(image);
	assert.equal(image.properties.src, "/blog/images/photo.webp");
	assert.equal(image.properties.poster, "/blog/images/poster.webp");
});

test("root deployments add no transformer", () => {
	assert.equal(rehypeBasePath({ base: "/" }), undefined);
});
