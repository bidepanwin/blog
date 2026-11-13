import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ids = [
	"self-reference",
	"ai-memory",
	"career-path",
	"information-stream",
	"academy",
	"learning-space",
	"engineering-terminal",
	"circuit-light",
	"knowledge-graph",
	"private-listening",
	"neuro-sama",
	"virtual-singer",
	"clannad",
	"hello-world",
	"math-physics",
	"philosophy",
];
const assignmentPairs = [
	["2026-10-17-hello", "self-reference"],
	["2026-10-18-animaeva-memory-eval", "ai-memory"],
	["2026-10-18-careeratlas", "career-path"],
	["2026-10-18-frontier-report", "information-stream"],
	["2026-10-18-olympia", "academy"],
	["2026-10-18-seeker-learning-region-market", "learning-space"],
	["2026-10-19-dsh-dotclaude", "engineering-terminal"],
	["2026-10-25-shardseek", "circuit-light"],
	["2026-11-02-blog-as-graph", "knowledge-graph"],
	["2026-11-06-diting", "private-listening"],
];
const positions = new Set([
	"center",
	"top",
	"bottom",
	"left",
	"right",
	"attention",
	"entropy",
]);
const fits = new Set(["cover", "blur"]);

if (!process.argv[2])
	throw new Error("Usage: node scripts/covers/materialize.mjs <selected.json>");
const ledgerPath = path.resolve(process.argv[2]);
const selected = JSON.parse(await readFile(ledgerPath, "utf8"));
if (!Array.isArray(selected) || selected.length !== ids.length) {
	throw new Error("Exactly 16 selected covers are required");
}
const byId = new Map(selected.map((entry) => [entry.id, entry]));
if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
	throw new Error("Selection IDs do not match the required 16 IDs");
}

for (const entry of selected) {
	for (const field of [
		"input",
		"alt",
		"sourceSite",
		"sourceUrl",
		"author",
		"authorization",
	]) {
		if (typeof entry[field] !== "string" || !entry[field].trim()) {
			throw new Error(`${entry.id}: invalid ${field}`);
		}
	}
	if (!positions.has(entry.position))
		throw new Error(`${entry.id}: invalid position`);
	if (!fits.has(entry.fit)) throw new Error(`${entry.id}: invalid fit`);
	if (
		!Array.isArray(entry.themes) ||
		entry.themes.length === 0 ||
		entry.themes.some((theme) => typeof theme !== "string" || !theme.trim())
	) {
		throw new Error(`${entry.id}: themes required`);
	}
	if (new URL(entry.sourceUrl).protocol !== "https:") {
		throw new Error(`${entry.id}: HTTPS source required`);
	}
	const expectedDirectory =
		path.join(root, ".shirones", "acg-cover-candidates", entry.id) + path.sep;
	const input = path.resolve(root, entry.input);
	if (!input.startsWith(expectedDirectory)) {
		throw new Error(
			`${entry.id}: input must stay in its own candidate directory`,
		);
	}
	entry.input = input;
	const metadata = await sharp(entry.input).metadata();
	const swapsAxes = (metadata.orientation ?? 1) >= 5;
	const sourceWidth = swapsAxes ? metadata.height : metadata.width;
	const sourceHeight = swapsAxes ? metadata.width : metadata.height;
	if (
		!sourceWidth ||
		!sourceHeight ||
		sourceWidth < 1600 ||
		sourceHeight < 900
	) {
		throw new Error(
			`${entry.id}: source must be at least 1600x900 after orientation, got ${sourceWidth}x${sourceHeight}`,
		);
	}
}

const outputDirectory = path.join(
	root,
	"src",
	"assets",
	"images",
	"post-covers",
);
await mkdir(outputDirectory, { recursive: true });
const library = [];
const composites = [];

for (const [index, id] of ids.entries()) {
	const entry = byId.get(id);
	const output = path.join(outputDirectory, `${id}.webp`);

	if (entry.fit === "cover") {
		await sharp(entry.input, { failOn: "error" })
			.rotate()
			.resize(1600, 900, {
				fit: "cover",
				position: entry.position,
				withoutEnlargement: true,
			})
			.webp({ quality: 86 })
			.toFile(output);
	} else {
		const background = await sharp(entry.input, { failOn: "error" })
			.rotate()
			.resize(1600, 900, {
				fit: "cover",
				position: entry.position,
				withoutEnlargement: true,
			})
			.blur(32)
			.modulate({ brightness: 0.55, saturation: 0.8 })
			.png()
			.toBuffer();
		const foreground = await sharp(entry.input, { failOn: "error" })
			.rotate()
			.resize(1600, 900, { fit: "inside", withoutEnlargement: true })
			.png()
			.toBuffer();
		await sharp(background)
			.composite([{ input: foreground, gravity: "center" }])
			.webp({ quality: 86 })
			.toFile(output);
	}

	library.push({
		id,
		file: `${id}.webp`,
		alt: entry.alt.trim(),
		themes: entry.themes,
		sourceSite: entry.sourceSite.trim(),
		sourceUrl: entry.sourceUrl.trim(),
		author: entry.author.trim(),
		authorization: entry.authorization.trim(),
	});
	const x = (index % 4) * 400;
	const y = Math.floor(index / 4) * 250;
	const thumbnail = await sharp(output)
		.resize(400, 225)
		.jpeg({ quality: 82 })
		.toBuffer();
	const label = Buffer.from(
		`<svg width="400" height="25"><rect width="400" height="25" fill="#151522"/><text x="10" y="18" fill="#ffffff" font-family="sans-serif" font-size="14">${id}</text></svg>`,
	);
	composites.push(
		{ input: thumbnail, left: x, top: y },
		{ input: label, left: x, top: y + 225 },
	);
}

const assignments = Object.fromEntries(assignmentPairs);
const source = `import type { PostCover, PostCoverAssignments } from "@/types/postCovers";\n\nexport const postCoverLibrary: PostCover[] = ${JSON.stringify(library, null, "\t")};\n\nexport const postCoverAssignments: PostCoverAssignments = ${JSON.stringify(assignments, null, "\t")};\n`;
await writeFile(
	path.join(root, "src", "data", "post-covers.ts"),
	source,
	"utf8",
);
const contactSheet = path.join(
	root,
	".shirones",
	"acg-cover-candidates",
	"contact-sheet.jpg",
);
await sharp({
	create: { width: 1600, height: 1000, channels: 3, background: "#151522" },
})
	.composite(composites)
	.jpeg({ quality: 88 })
	.toFile(contactSheet);
console.log(`Wrote 16 covers, src/data/post-covers.ts, and ${contactSheet}`);
