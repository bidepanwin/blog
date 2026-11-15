import { expect, test } from "@playwright/test";
import { musicConfig, resolveMusicOptions } from "../../src/config/musicConfig";
import { sitePath } from "./paths";

// Exercise native HTMLAudioElement decoding and its clock without depending on
// a CI sound device. The output sink is silent; no media API is mocked.
test.use({ launchOptions: { args: ["--disable-audio-output"] } });

function testTone(): Buffer {
	const sampleRate = 12_000;
	const samples = sampleRate * 45;
	const wav = Buffer.alloc(44 + samples * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		wav.writeInt16LE(
			Math.round(Math.sin((i * 2 * Math.PI * 440) / sampleRate) * 8_000),
			44 + i * 2,
		);
	return wav;
}

test("native playback advances, survives seeking, and continues through navigation", async ({
	page,
}) => {
	test.skip(
		!resolveMusicOptions(musicConfig)?.playlist.length,
		"Requires the enabled local music widget",
	);
	const wav = testTone();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route(
		/\/assets\/music\/url\/[^?]+\.(?:mp3|m4a)(?:\?.*)?$/,
		async (route) => {
			const range = /^bytes=(\d+)-(\d*)$/.exec(
				route.request().headers().range || "",
			);
			const start = range ? Number(range[1]) : 0;
			const end = range?.[2]
				? Math.min(Number(range[2]), wav.length - 1)
				: wav.length - 1;
			await route.fulfill({
				status: range ? 206 : 200,
				contentType: "audio/wav",
				headers: {
					"Accept-Ranges": "bytes",
					...(range
						? { "Content-Range": `bytes ${start}-${end}/${wav.length}` }
						: {}),
				},
				body: wav.subarray(start, end + 1),
			});
		},
	);
	await page.addInitScript(() => {
		const audioWindow = window as typeof window & {
			__playbackAudio?: HTMLAudioElement;
			__seekCount: number;
		};
		const NativeAudio = window.Audio;
		audioWindow.__seekCount = 0;
		window.Audio = class extends NativeAudio {
			constructor(...args: ConstructorParameters<typeof Audio>) {
				super(...args);
				audioWindow.__playbackAudio = this;
				this.addEventListener("seeking", () => audioWindow.__seekCount++);
			}
		};
	});
	await page.goto(sitePath("/"));
	const player = page.locator("[data-music-player]");
	await player.getByRole("button", { name: "播放", exact: true }).click();
	const progress = player.locator(
		'.music-player__progress input[type="range"]',
	);
	await expect(progress).toHaveAttribute("max", "45");
	await expect
		.poll(() => progress.inputValue().then(Number))
		.toBeGreaterThan(0.5);
	const bounds = await progress.boundingBox();
	if (!bounds) throw new Error("Progress slider is not visible");
	await page.mouse.click(
		bounds.x + bounds.width * 0.5,
		bounds.y + bounds.height / 2,
	);
	await expect
		.poll(() => progress.inputValue().then(Number))
		.toBeGreaterThan(20);
	const afterSeek = Number(await progress.inputValue());
	await expect
		.poll(() => progress.inputValue().then(Number))
		.toBeGreaterThan(afterSeek + 0.5);
	const playback = () =>
		page.evaluate(() => {
			const w = window as typeof window & {
				__playbackAudio?: HTMLAudioElement;
				__seekCount: number;
			};
			return {
				paused: w.__playbackAudio?.paused,
				error: w.__playbackAudio?.error?.code,
				seeks: w.__seekCount,
			};
		});
	expect(await playback()).toEqual({
		paused: false,
		error: undefined,
		seeks: 1,
	});
	const beforeNavigation = Number(await progress.inputValue());
	await page
		.locator(`a[href="${sitePath("/about/")}"]`)
		.first()
		.click();
	await expect(page).toHaveURL(new RegExp(`${sitePath("/about/")}$`));
	await expect
		.poll(() => progress.inputValue().then(Number))
		.toBeGreaterThan(beforeNavigation + 0.2);
	expect((await playback()).paused).toBe(false);
	expect(errors).toEqual([]);
});
