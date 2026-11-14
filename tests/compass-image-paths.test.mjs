import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { compile, preprocess } from "svelte/compiler";

const root = fileURLToPath(new URL("../", import.meta.url));

// Exercise the real tile even when the optional compass route is disabled.
// SSR compilation needs no browser, dev server, fixture page or data edits.
const built = await build({
	absWorkingDir: root,
	stdin: {
		contents: `
			import CompassTile from "./src/components/molecules/CompassTile.svelte";
			import { render } from "svelte/server";
			export function renderTile(entry) {
				return render(CompassTile, { props: { entry } }).body;
			}
		`,
		resolveDir: root,
	},
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
	define: {
		"import.meta.env.BASE_URL": JSON.stringify("/blog/"),
		"import.meta.env.DEV": "false",
	},
	alias: {
		"@iconify/svelte": path.join(
			root,
			"src/components/atoms/display/Icon.svelte",
		),
		"@shirone/iconify-offline": path.join(
			root,
			"node_modules/@iconify/svelte/dist/OfflineIcon.svelte",
		),
		"@shirone/iconify-offline-functions": path.join(
			root,
			"node_modules/@iconify/svelte/dist/offline-functions.js",
		),
	},
	plugins: [
		{
			name: "svelte-ssr-test",
			setup(builder) {
				builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
					const source = await preprocess(
						await readFile(filename, "utf8"),
						{ style: () => ({ code: "" }) },
						{ filename },
					);
					const compiled = compile(source.code, {
						filename,
						generate: "server",
					});
					return {
						contents: compiled.js.code,
						loader: "js",
						resolveDir: path.dirname(filename),
					};
				});
			},
		},
	],
});

const { renderTile } = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);
const entry = { label: "Example", href: "https://example.com" };

test("compass images use the Pages base exactly once, including icon image URLs", () => {
	for (const property of ["image", "icon"]) {
		for (const source of [
			"/images/example.webp",
			"/blog/images/example.webp",
		]) {
			const html = renderTile({ ...entry, [property]: source });
			assert.match(html, /<img\b[^>]*src="\/blog\/images\/example\.webp"/);
			assert.doesNotMatch(html, /\/blog\/blog\//);
		}
	}
});

test("compass external images stay external and image overrides icon", () => {
	const html = renderTile({
		...entry,
		image: "https://cdn.example.com/photo.webp",
		icon: "material-symbols:code-rounded",
	});
	assert.match(
		html,
		/<img\b[^>]*src="https:\/\/cdn\.example\.com\/photo\.webp"/,
	);
	assert.doesNotMatch(html, /<svg\b/);
});

test("compass Iconify identifiers still render an SVG instead of becoming URLs", () => {
	const html = renderTile({ ...entry, icon: "material-symbols:code-rounded" });
	assert.match(html, /<svg\b/);
	assert.doesNotMatch(html, /<img\b|\/blog\/material-symbols/);
});
