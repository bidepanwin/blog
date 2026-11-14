/** Local-manager image selection only; this module is never shipped to the blog. */
export function createMediaPicker({ api, getMedia, onUpload }) {
	const $ = (id) => document.getElementById(id);
	const dialog = $("media-picker-dialog");
	const token =
		document.querySelector('meta[name="manager-token"]')?.content || "";
	let current = null;
	let selected = null;
	let settle = null;
	let generation = 0;
	let operation = 0;
	let trigger = null;
	let previewTimer = null;

	function clearError() {
		$("media-picker-error").hidden = true;
		$("media-picker-error").textContent = "";
	}
	function fail(error) {
		$("media-picker-error").textContent =
			error?.message || "图片处理失败，请重试。";
		$("media-picker-error").hidden = false;
		$("media-picker-status").textContent = "";
	}
	function invalidate() {
		operation += 1;
		selected = null;
		clearTimeout(previewTimer);
		$("media-picker-confirm").disabled = true;
		const image = $("media-picker-preview-image");
		image.onload = null;
		image.onerror = null;
		image.removeAttribute("src");
		image.hidden = true;
		$("media-picker-preview-empty").hidden = false;
		$("media-picker-preview-empty").textContent = "选择图片后在这里预览";
		$("media-picker-reference").textContent = "";
		clearError();
		return operation;
	}
	function active(session, request) {
		return dialog.open && generation === session && operation === request;
	}
	function mediaUrl(path) {
		return (
			"/api/media?path=" +
			encodeURIComponent(path) +
			"&token=" +
			encodeURIComponent(token)
		);
	}
	function finish(result) {
		if (!settle) return;
		const resolve = settle;
		settle = null;
		generation += 1;
		invalidate();
		current = null;
		dialog.close();
		if (trigger?.isConnected) trigger.focus();
		resolve(result);
	}
	function showMode(next) {
		invalidate();
		$("media-picker-status").textContent = "";
		for (const button of dialog.querySelectorAll("[data-picker-mode]")) {
			const chosen = button.dataset.pickerMode === next;
			button.classList.toggle("is-selected", chosen);
			button.setAttribute("aria-pressed", String(chosen));
		}
		for (const panel of dialog.querySelectorAll("[data-picker-panel]"))
			panel.hidden = panel.dataset.pickerPanel !== next;
		if (next === "library") renderLibrary();
	}
	function showResolved(result, session, request) {
		if (!active(session, request)) return;
		$("media-picker-reference").textContent = result.reference || "";
		const image = $("media-picker-preview-image");
		const empty = $("media-picker-preview-empty");
		if (!result.path) {
			// Remote URLs are retained without making requests from the local editor.
			empty.textContent = "外部图片链接已识别，请确认图片可访问。";
			selected = result;
			$("media-picker-confirm").disabled = false;
			$("media-picker-status").textContent = "图片链接已就绪";
			return;
		}
		$("media-picker-status").textContent = "正在载入预览…";
		image.onload = () => {
			if (!active(session, request)) return;
			clearTimeout(previewTimer);
			if (!image.naturalWidth) {
				fail(new Error("这张图片无法预览，请选择其他图片。"));
				return;
			}
			image.hidden = false;
			empty.hidden = true;
			selected = result;
			$("media-picker-confirm").disabled = false;
			$("media-picker-status").textContent = "图片已就绪，点击使用图片后填入编辑器。";
		};
		image.onerror = () => {
			if (!active(session, request)) return;
			clearTimeout(previewTimer);
			fail(new Error("无法载入图片预览，请检查文件是否完整。"));
		};
		previewTimer = setTimeout(() => {
			if (!active(session, request)) return;
			image.onload = null;
			image.onerror = null;
			fail(new Error("图片预览超时，请重新选择。"));
		}, 15_000);
		image.src = mediaUrl(result.path);
	}
	async function resolveReference(reference, prefix = "") {
		if (!current) return;
		const session = generation;
		const request = invalidate();
		$("media-picker-status").textContent = "正在检查图片路径…";
		try {
			const result = await api("/api/media/resolve", {
				method: "POST",
				body: JSON.stringify({
					reference,
					prefix,
					documentPath: current.documentPath,
				}),
			});
			showResolved(result, session, request);
		} catch (error) {
			if (active(session, request)) fail(error);
		}
	}
	function renderLibrary() {
		const grid = $("media-picker-grid");
		grid.replaceChildren();
		const search = $("media-picker-search").value.trim().toLowerCase();
		const files = getMedia().filter((file) =>
			`${file.path} ${file.reference || ""}`.toLowerCase().includes(search),
		);
		$("media-picker-library-count").textContent = `${files.length} 个图片文件`;
		if (!files.length) {
			const message = document.createElement("p");
			message.className = "list-empty";
			message.textContent = "没有匹配的图片，试试其他关键词或选择本地文件。";
			grid.append(message);
		}
		for (const file of files) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "media-picker-item";
			button.title = file.path;
			const image = document.createElement("img");
			image.src = mediaUrl(file.path);
			image.loading = "lazy";
			image.alt = "";
			const name = document.createElement("span");
			name.textContent = file.path.split("/").pop();
			const path = document.createElement("small");
			path.textContent = file.reference || file.path;
			button.append(image, name, path);
			button.addEventListener("click", () => {
				for (const item of grid.querySelectorAll("button"))
					item.setAttribute("aria-pressed", String(item === button));
				void resolveReference(file.reference || file.path);
			});
			grid.append(button);
		}
	}
	function readBase64(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
			reader.onerror = () => reject(new Error("无法读取图片文件。"));
			reader.readAsDataURL(file);
		});
	}
	async function upload(file) {
		if (!file || !current) return;
		const session = generation;
		const request = invalidate();
		const documentPath = current.documentPath;
		$("media-picker-local").disabled = true;
		try {
			if (!/\.(?:jpe?g|png|webp|gif|avif)$/i.test(file.name))
				throw new Error("请选择 JPEG、PNG、WebP、GIF 或 AVIF 图片。");
			if (file.size > 10 * 1024 * 1024)
				throw new Error("图片超过 10 MiB，请压缩后再选择。");
			$("media-picker-status").textContent = `正在添加 ${file.name}…`;
			const uploaded = await api("/api/upload", {
				method: "POST",
				body: JSON.stringify({ name: file.name, data: await readBase64(file) }),
			});
			await onUpload?.();
			if (!active(session, request)) return;
			const result = await api("/api/media/resolve", {
				method: "POST",
				body: JSON.stringify({
					reference: uploaded.reference || uploaded.path,
					documentPath,
				}),
			});
			showResolved(result, session, request);
		} catch (error) {
			if (active(session, request)) fail(error);
		} finally {
			if (generation === session) {
				$("media-picker-local").disabled = false;
				$("media-picker-local").value = "";
			}
		}
	}
	for (const button of dialog.querySelectorAll("[data-picker-mode]"))
		button.addEventListener("click", () => showMode(button.dataset.pickerMode));
	for (const id of ["media-picker-close", "media-picker-cancel"])
		$(id).addEventListener("click", () => finish(null));
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		finish(null);
	});
	dialog.addEventListener("close", () => {
		if (!dialog.open) finish(null);
	});
	$("media-picker-confirm").addEventListener("click", () => {
		if (selected && !$("media-picker-confirm").disabled) finish(selected);
	});
	$("media-picker-search").addEventListener("input", renderLibrary);
	for (const id of ["media-picker-prefix", "media-picker-path"]) {
		$(id).addEventListener("input", () => {
			invalidate();
			$("media-picker-status").textContent = "修改后请点击检查路径并预览。";
		});
		$(id).addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			void resolveReference(
				$("media-picker-path").value,
				$("media-picker-prefix").value,
			);
		});
	}
	$("media-picker-resolve").addEventListener("click", () =>
		void resolveReference(
			$("media-picker-path").value,
			$("media-picker-prefix").value,
		),
	);
	$("media-picker-local").addEventListener("change", (event) =>
		void upload(event.target.files?.[0]),
	);
	const drop = $("media-picker-drop");
	drop.addEventListener("dragover", (event) => {
		event.preventDefault();
		drop.classList.add("is-dragging");
	});
	drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
	drop.addEventListener("drop", (event) => {
		event.preventDefault();
		drop.classList.remove("is-dragging");
		if (!$("media-picker-local").disabled)
			void upload(event.dataTransfer.files?.[0]);
	});

	return {
		pick(options = {}) {
			if (settle) return Promise.resolve(null);
			trigger = document.activeElement;
			generation += 1;
			current = options;
			$("media-picker-usage").textContent = options.usage
				? `用于：${options.usage}`
				: "选择图片后，系统会生成适合当前位置的引用。";
			$("media-picker-local").value = "";
			$("media-picker-local").disabled = false;
			$("media-picker-search").value = "";
			$("media-picker-prefix").value = "";
			$("media-picker-path").value = options.currentValue || "";
			showMode(options.currentValue ? "path" : "local");
			dialog.showModal();
			const promise = new Promise((resolve) => {
				settle = resolve;
			});
			if (options.currentValue) void resolveReference(options.currentValue);
			return promise;
		},
	};
}
