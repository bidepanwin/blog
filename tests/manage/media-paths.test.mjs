import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
	mediaReference,
	resolveMediaReference,
} from "../../scripts/manage/media-paths.mjs";

const files = [
	{ path: "public/images/uploads/hello.png" },
	{ path: "public/images/封面 test (1).webp" },
	{ path: "public/assets/moments/thumbnails/a.webp" },
	{ path: "src/assets/images/banner/a.webp" },
	{ path: "src/assets/images/封面 test.png" },
];
const options = {
	root: "D:/blog project",
	files,
	base: "/blog/",
	siteUrl: "https://bidepanwin.github.io/blog/",
};
const resolve = (input) => resolveMediaReference(input, options);

test("public references normalize repository, deployed, prefixed and absolute disk paths", () => {
	for (const reference of [
		"/images/uploads/hello.png",
		"images/uploads/hello.png",
		"public/images/uploads/hello.png",
		"/blog/images/uploads/hello.png",
		"/blog/blog/images/uploads/hello.png",
		"https://bidepanwin.github.io/blog/images/uploads/hello.png?version=1",
		"D:\\blog project\\public\\images\\uploads\\hello.png",
		'"d:/BLOG PROJECT/public/images/uploads/hello.png"',
	]) {
		assert.deepEqual(
			resolve({ reference }),
			{
				kind: "local",
				path: files[0].path,
				reference: "/images/uploads/hello.png",
				markdownReference: "/images/uploads/hello.png",
			},
			reference,
		);
	}
});

test("prefix plus filename joins once and accepts both site URLs and disk directories", () => {
	for (const prefix of [
		"/images/uploads/",
		"public\\images\\uploads",
		"D:\\blog project\\public\\images\\uploads",
		"https://bidepanwin.github.io/blog/images/uploads",
	]) {
		assert.equal(
			resolve({ prefix, reference: "hello.png" }).path,
			files[0].path,
		);
	}
	assert.equal(
		resolve({
			prefix: "/images/uploads/",
			reference: "/images/uploads/hello.png",
		}).path,
		files[0].path,
	);
	assert.equal(
		resolve({
			prefix: "/images/uploads/",
			reference: "public/images/uploads/hello.png",
		}).path,
		files[0].path,
	);
	assert.equal(
		resolve({
			prefix: "https://cdn.example.test/photos",
			reference: "hello.png",
		}).reference,
		"https://cdn.example.test/photos/hello.png",
	);
});

test("source assets keep config references and derive Markdown paths for nested content", () => {
	for (const reference of [
		"assets/images/banner/a.webp",
		"src/assets/images/banner/a.webp",
		"/src/assets/images/banner/a.webp",
		"../../assets/images/banner/a.webp",
	]) {
		assert.deepEqual(
			resolve({ reference, documentPath: "src/content/posts/post.md" }),
			{
				kind: "local",
				path: "src/assets/images/banner/a.webp",
				reference: "assets/images/banner/a.webp",
				markdownReference: "../../assets/images/banner/a.webp",
			},
			reference,
		);
	}
	assert.equal(
		resolve({
			reference: "../../../assets/images/banner/a.webp",
			documentPath: "src/content/posts/travel/post.md",
		}).markdownReference,
		"../../../assets/images/banner/a.webp",
	);
	assert.equal(
		resolve({
			reference: "./a.webp",
			documentPath: "src/assets/images/banner/post.md",
		}).path,
		files[3].path,
	);
});

test("URL encoding is canonical for public files while source references remain import paths", () => {
	const publicFile = files[1];
	const canonical = "/images/%E5%B0%81%E9%9D%A2%20test%20(1).webp";
	assert.equal(mediaReference(publicFile.path), canonical);
	assert.equal(resolve({ reference: canonical }).path, publicFile.path);
	assert.equal(
		resolve({ reference: "public/images/封面 test (1).webp" }).reference,
		canonical,
	);
	assert.equal(
		resolve({
			reference: "assets/images/封面 test.png",
			documentPath: "src/content/posts/example.md",
		}).markdownReference,
		"../../assets/images/封面 test.png",
	);
	assert.equal(
		resolve({ reference: "/assets/moments/thumbnails/a.webp" }).path,
		files[2].path,
	);
});

test("remote URLs are retained without touching disk or fetching them", () => {
	const result = resolve({
		reference: "https://cdn.example.test/封面.webp?x=1#part",
	});
	assert.equal(result.kind, "remote");
	assert.equal(
		result.reference,
		"https://cdn.example.test/%E5%B0%81%E9%9D%A2.webp?x=1#part",
	);
	assert.equal(result.markdownReference, result.reference);
	assert.equal(result.path, undefined);
});

test("resolver denies missing media, invalid schemes, external disk paths and malformed payloads", () => {
	for (const reference of [
		".env",
		"../.env",
		"public/../.env",
		"/images/uploads/missing.png",
		"public/images/../../../.git/config",
		"src/assets/images/../../config/siteConfig.ts",
	]) {
		assert.throws(
			() => resolve({ reference }),
			(error) => error.status === 404,
			reference,
		);
	}
	for (const reference of [
		"C:\\Windows\\photo.png",
		"D:/blog project-other/public/images/uploads/hello.png",
		"javascript:alert(1)",
		"data:image/png;base64,abc",
		"//other-server/share/photo.png",
		"%notencoded",
	]) {
		assert.throws(
			() => resolve({ reference }),
			(error) => error.status === 400,
			reference,
		);
	}
	for (const input of [
		null,
		[],
		{},
		{ reference: "" },
		{ reference: 1 },
		{ reference: "a\u0000.png" },
		{
			reference: "/images/uploads/hello.png",
			documentPath: "../../outside.md",
		},
	]) {
		assert.throws(
			() => resolve(input),
			(error) => error.status === 400,
		);
	}
});

test("POSIX absolute paths work only when they resolve to allowlisted media below the root", () => {
	const root = path.resolve("/tmp/example-blog");
	assert.equal(
		resolveMediaReference(
			{ reference: `${root}/public/images/uploads/hello.png` },
			{ ...options, root },
		).path,
		files[0].path,
	);
});
