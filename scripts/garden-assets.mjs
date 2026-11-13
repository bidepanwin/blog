import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../public/images/garden/", import.meta.url));
const photos = {
	hero: "hero", garden: "forest", forest: "forest", workspace: "desk",
	notebook: "notes", books: "books", lake: "hero", journey: "journey",
};
for (const [output, source] of Object.entries(photos)) {
	await sharp(path.join(root, `${source}.jpg`)).rotate().resize({ width: output === "hero" ? 1500 : 900 }).webp({ quality: 80 }).toFile(path.join(root, `${output}.webp`));
}
await sharp(path.join(root, "forest.jpg")).resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toFile(path.join(root, "avatar.webp"));
