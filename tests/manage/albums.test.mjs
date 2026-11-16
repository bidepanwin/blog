import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	readCollection,
	validateCollection,
	writeCollection,
} from "../../scripts/manage/collections.mjs";
import { createManagerServer } from "../../scripts/manage/server.mjs";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
).toString("base64");

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), "shirone-albums-"));
	const albumDir = path.join(root, "public/images/albums/demo");
	await mkdir(albumDir, { recursive: true });
	await writeFile(
		path.join(albumDir, "info.json"),
		`${JSON.stringify(
			{
				title: "Demo",
				description: "",
				date: "2026-11-16",
				location: "",
				tags: [],
				layout: "masonry",
				columns: 3,
				hidden: false,
				mode: "external",
				photos: [{ src: "https://example.test/a.webp" }],
			},
			null,
			2,
		)}\n`,
	);
	const jobs = {
		isRunning: () => false,
		record: async () => {},
		gitState: async () => ({}),
	};
	const manager = createManagerServer({ root, token: "test-albums", jobs });
	await new Promise((resolve) =>
		manager.server.listen(0, "127.0.0.1", resolve),
	);
	const origin = `http://127.0.0.1:${manager.server.address().port}`;
	t.after(async () => {
		await new Promise((resolve) => manager.server.close(resolve));
		await rm(root, { recursive: true, force: true });
	});
	const request = async (route, method, body) => {
		const response = await fetch(origin + route, {
			method,
			headers: {
				"x-manager-token": manager.token,
				origin,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return { status: response.status, json: await response.json() };
	};
	return { root, albumDir, request };
}

test("项目集合的可视化读写保留四个 GitHub 仓库", async () => {
	const sourcePath = fileURLToPath(
		new URL("../../src/data/projects.ts", import.meta.url),
	);
	const source = await readFile(sourcePath, "utf8");
	const data = readCollection(source, "projects");
	assert.equal(data.items.length, 5);
	assert.equal(
		data.items.filter((item) => item.repository).length,
		4,
		"about 页列出的四个公开仓库均已收录",
	);
	const clean = validateCollection("projects", {
		items: data.items,
		comments: data.comments,
		tailComments: data.tailComments,
	});
	const rewritten = writeCollection(source, "projects", clean);
	assert.match(
		rewritten,
		/https:\/\/github\.com\/bidepanwin\/Financial-RAG/u,
		"写回后链接不丢失",
	);
});

test("相册列表、保存、新建与上传走同一套本地文件契约", async (t) => {
	const { root, albumDir, request } = await fixture(t);

	const list = await request("/api/albums", "GET");
	assert.equal(list.status, 200);
	assert.equal(list.json.albums.length, 1);
	assert.equal(list.json.albums[0].info.title, "Demo");

	const saved = await request("/api/albums", "PUT", {
		id: "demo",
		values: {
			title: "改过的标题",
			description: "说明",
			date: "2026-11-16",
			location: "杭州",
			tags: ["风景", "日常"],
			layout: "grid",
			columns: 4,
			hidden: true,
		},
	});
	assert.equal(saved.status, 200);
	const info = JSON.parse(
		await readFile(path.join(albumDir, "info.json"), "utf8"),
	);
	assert.equal(info.title, "改过的标题");
	assert.equal(info.columns, 4);
	assert.equal(info.mode, "external");
	assert.equal(info.photos.length, 1);

	const created = await request("/api/albums/create", "POST", {
		id: "new-one",
		title: "新相册",
	});
	assert.equal(created.status, 200);
	const createdInfo = JSON.parse(
		await readFile(
			path.join(root, "public/images/albums/new-one/info.json"),
			"utf8",
		),
	);
	assert.equal(createdInfo.title, "新相册");
	assert.equal(createdInfo.columns, 3);

	const uploaded = await request("/api/albums/upload", "POST", {
		id: "new-one",
		name: "01.png",
		data: PNG,
		asCover: false,
	});
	assert.equal(uploaded.status, 200);
	assert.equal(uploaded.json.path, "public/images/albums/new-one/01.png");

	const badCover = await request("/api/albums/upload", "POST", {
		id: "new-one",
		name: "photo.png",
		data: PNG,
		asCover: true,
	});
	assert.equal(badCover.status, 400, "封面固定为 WebP，避免双封面冲突");

	const traversal = await request("/api/albums/create", "POST", {
		id: "../escape",
		title: "bad",
	});
	assert.equal(traversal.status, 400);

	const after = await request("/api/albums", "GET");
	assert.equal(after.json.albums.length, 2);
	assert.equal(
		after.json.albums.find((album) => album.id === "new-one").photos.length,
		1,
	);
});

/** 最小可识别的 RIFF/WEBP 签名，供封面格式校验使用。 */
function webpBytes() {
	const bytes = Buffer.alloc(16);
	bytes.write("RIFF", 0, "ascii");
	bytes.writeUInt32LE(8, 4);
	bytes.write("WEBP", 8, "ascii");
	bytes.write("VP8 ", 12, "ascii");
	return bytes;
}

test("相册可从素材库导入图片并拒绝非法来源与非 WebP 封面", async (t) => {
	const { root, albumDir, request } = await fixture(t);
	const uploads = path.join(root, "public/images/uploads");
	await mkdir(uploads, { recursive: true });
	await writeFile(path.join(uploads, "sample.png"), Buffer.from(PNG, "base64"));
	await writeFile(path.join(uploads, "cover.webp"), webpBytes());

	const first = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "public/images/uploads/sample.png",
		asCover: false,
	});
	assert.equal(first.status, 200);
	assert.equal(first.json.path, "public/images/albums/demo/01.png");

	const second = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "public/images/uploads/sample.png",
		asCover: false,
	});
	assert.equal(second.status, 200, "同一素材可重复添加");
	assert.equal(second.json.path, "public/images/albums/demo/02.png");

	const cover = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "public/images/uploads/cover.webp",
		asCover: true,
	});
	assert.equal(cover.status, 200);
	assert.equal(cover.json.path, "public/images/albums/demo/cover.webp");

	const badCover = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "public/images/uploads/sample.png",
		asCover: true,
	});
	assert.equal(badCover.status, 400, "封面固定为 WebP");

	const unknown = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "public/images/uploads/missing.png",
		asCover: false,
	});
	assert.equal(unknown.status, 404, "只能复制素材库 allowlist 内的文件");

	const traversal = await request("/api/albums/import", "POST", {
		id: "demo",
		path: "../../package.json",
		asCover: false,
	});
	assert.equal(traversal.status, 404, "拒绝读取项目外文件");

	const bytes = await readFile(path.join(albumDir, "01.png"));
	assert.equal(bytes.toString("base64"), PNG, "复制后字节保持一致");

	const list = await request("/api/albums", "GET");
	assert.equal(list.json.albums[0].photos.length, 2);
	assert.equal(
		list.json.albums[0].coverPath,
		"public/images/albums/demo/cover.webp",
	);
});
