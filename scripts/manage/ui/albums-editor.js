/**
 * 相册可视化编辑器（本地管理台）。
 * 服务端契约见 scripts/manage/albums.mjs 与 public/images/albums/README.md：
 * 一个目录一个相册，info.json 存元数据，cover.webp 为封面，其余图片自动扫描。
 */
const node = (tag, className, text) => {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = String(text);
	return element;
};

const FIELDS = [
	{ key: "title", label: "相册标题", type: "text", wide: true },
	{ key: "description", label: "描述", type: "textarea", wide: true },
	{ key: "date", label: "日期", type: "text", placeholder: "YYYY-MM-DD" },
	{ key: "location", label: "地点", type: "text" },
	{
		key: "tags",
		label: "标签",
		type: "text",
		wide: true,
		help: "多个标签用逗号分隔。",
	},
	{
		key: "layout",
		label: "布局",
		type: "select",
		options: [
			["masonry", "瀑布流"],
			["grid", "网格"],
		],
	},
	{ key: "columns", label: "列数", type: "number" },
	{ key: "hidden", label: "从列表隐藏", type: "checkbox" },
	{ key: "password", label: "访问密码", type: "text" },
	{ key: "passwordHint", label: "密码提示", type: "text" },
];

const saveHint = (dirty) =>
	dirty
		? "保存上方表单的修改到 info.json（Ctrl / ⌘ + S）"
		: "表单没有未保存的修改；点击可查看当前状态，照片与封面上传后立即写入相册目录";

async function toBase64(file) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000)
		binary += String.fromCharCode.apply(
			null,
			bytes.subarray(index, index + 0x8000),
		);
	return btoa(binary);
}

export function mountAlbumsEditor({
	container,
	api,
	mediaUrl,
	toast,
	onDirty,
	openSource,
	pickMedia,
}) {
	let albums = [];
	let selected = null;
	let dirty = false;
	let creating = false;
	let busy = false;
	let form = null;
	// 未保存的表单值：上传 / 导入图片会触发多次 render()，需要跨渲染保留。
	let pendingValues = null;

	const current = () => albums.find((album) => album.id === selected) || null;

	function setDirty(value) {
		dirty = value;
		if (!value) pendingValues = null;
		onDirty(value);
		const button = container.querySelector("[data-albums-save]");
		if (button) {
			button.disabled = busy;
			button.title = saveHint(value);
		}
		const status = container.querySelector("[data-albums-state]");
		if (status) {
			status.textContent = value ? "表单有未保存的修改" : "表单已保存";
			status.classList.toggle("is-dirty", value);
		}
	}

	function collect() {
		const values = {};
		if (!form) return values;
		for (const input of form.querySelectorAll("[data-key]")) {
			const key = input.dataset.key;
			const field = FIELDS.find((entry) => entry.key === key);
			if (field.type === "checkbox") values[key] = input.checked;
			else if (key === "tags")
				values[key] = input.value
					.split(/[,，]/)
					.map((tag) => tag.trim())
					.filter(Boolean);
			else if (field.type === "number") values[key] = Number(input.value);
			else {
				if (key === "date" && !input.value.trim()) continue;
				values[key] = input.value;
			}
		}
		return values;
	}

	// 上传 / 导入图片后需要重新拉取相册列表，这里把尚未保存的表单值写回新建的表单，
	// 避免 load() 重渲染时静默丢弃用户刚填的内容。
	function applyValues(values) {
		if (!form) return;
		for (const input of form.querySelectorAll("[data-key]")) {
			const key = input.dataset.key;
			if (!Object.hasOwn(values, key)) {
				// collect() 会跳过空的日期（保留服务端原值），这里保持输入框为空的状态。
				if (key === "date") input.value = "";
				continue;
			}
			const field = FIELDS.find((entry) => entry.key === key);
			if (field.type === "checkbox") input.checked = values[key] === true;
			else if (key === "tags") input.value = values[key].join(", ");
			else input.value = String(values[key] ?? "");
		}
	}

	function buildForm(album) {
		const element = node("form", "albums-form");
		const syncPending = () => {
			setDirty(true);
			if (pendingValues) pendingValues = collect();
		};
		element.addEventListener("submit", (event) => event.preventDefault());
		element.addEventListener("input", syncPending);
		element.addEventListener("change", syncPending);
		const info = album.info || {};
		for (const field of FIELDS) {
			const wrap = node("div", `field${field.wide ? " field-wide" : ""}`);
			const label = node("label", "", field.label);
			const id = `album-field-${field.key}`;
			label.htmlFor = id;
			let input;
			if (field.type === "textarea") {
				input = node("textarea");
				input.rows = 3;
			} else if (field.type === "select") {
				input = node("select");
				for (const [value, text] of field.options) {
					const option = node("option", "", text);
					option.value = value;
					input.append(option);
				}
			} else {
				input = node("input");
				input.type = field.type === "number" ? "number" : "text";
			}
			input.id = id;
			input.dataset.key = field.key;
			input.autocomplete = "off";
			if (field.placeholder) input.placeholder = field.placeholder;
			if (field.type === "number") {
				input.min = "2";
				input.max = "4";
				input.step = "1";
			}
			if (field.type === "checkbox") input.checked = info[field.key] === true;
			else if (field.key === "tags")
				input.value = Array.isArray(info.tags) ? info.tags.join(", ") : "";
			else input.value = String(info[field.key] ?? "");
			wrap.append(label, input);
			if (field.help) wrap.append(node("span", "field-hint", field.help));
			element.append(wrap);
		}
		return element;
	}

	function buildCreate() {
		const element = node("form", "albums-create");
		element.append(node("strong", "", "新建相册"));
		const idWrap = node("div", "field");
		const idLabel = node("label", "", "目录标识");
		idLabel.htmlFor = "album-new-id";
		const idInput = node("input");
		idInput.id = "album-new-id";
		idInput.required = true;
		idInput.pattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
		idInput.placeholder = "weekend-trip";
		idWrap.append(idLabel, idInput);
		const titleWrap = node("div", "field");
		const titleLabel = node("label", "", "相册标题");
		titleLabel.htmlFor = "album-new-title";
		const titleInput = node("input");
		titleInput.id = "album-new-title";
		titleInput.placeholder = "周末出行";
		titleWrap.append(titleLabel, titleInput);
		const actions = node("div", "albums-create-actions");
		const submit = node("button", "button button-primary", "创建");
		submit.type = "submit";
		const cancel = node("button", "button", "取消");
		cancel.type = "button";
		cancel.addEventListener("click", () => {
			creating = false;
			render();
		});
		actions.append(submit, cancel);
		element.append(idWrap, titleWrap, actions);
		element.addEventListener("submit", async (event) => {
			event.preventDefault();
			if (busy) return;
			if (dirty && !window.confirm("当前修改尚未保存，仍要新建相册吗？"))
				return;
			const id = idInput.value.trim();
			busy = true;
			try {
				await api("/api/albums/create", {
					method: "POST",
					body: JSON.stringify({ id, title: titleInput.value.trim() }),
				});
				creating = false;
				selected = id;
				toast("相册已创建，请上传封面后发布");
				await load(true);
			} catch (error) {
				toast(error.message || "创建失败");
			} finally {
				busy = false;
				render();
			}
		});
		return element;
	}

	function buildList() {
		const list = node("div", "albums-list");
		if (!albums.length) return list;
		for (const album of albums) {
			const button = node(
				"button",
				`albums-item${album.id === selected ? " is-active" : ""}`,
			);
			button.type = "button";
			if (album.coverPath) {
				const image = node("img", "albums-thumb");
				image.src = mediaUrl(album.coverPath);
				image.alt = "";
				image.loading = "lazy";
				button.append(image);
			} else
				button.append(
					node("span", "albums-thumb albums-thumb-empty", "无封面"),
				);
			const copy = node("div", "albums-item-copy");
			copy.append(
				node("strong", "", album.info?.title || album.id),
				node("span", "", `${album.id} · ${album.photos.length} 张照片`),
			);
			const flags = node("span", "albums-item-flags");
			if (album.info?.hidden) flags.append(node("span", "", "隐藏"));
			if (album.info?.password) flags.append(node("span", "", "加密"));
			if (!album.info) flags.append(node("span", "", album.infoError));
			if (flags.childNodes.length) copy.append(flags);
			button.append(copy);
			button.addEventListener("click", () => {
				if (album.id === selected) return;
				if (
					dirty &&
					!window.confirm("当前修改尚未保存，切换相册会丢失修改。继续吗？")
				)
					return;
				selected = album.id;
				setDirty(false);
				render();
			});
			list.append(button);
		}
		return list;
	}

	function buildPhotos(album) {
		const section = node("section", "albums-photos-section");
		section.append(
			node(
				"h3",
				"",
				`照片（${album.photos.length}）${album.coverPath ? " · 已设封面" : " · 未设封面"}`,
			),
		);
		if (album.photos.length) {
			const grid = node("div", "albums-photos");
			for (const photo of album.photos) {
				const card = node("figure", "albums-photo");
				const image = node("img");
				image.src = mediaUrl(photo.path);
				image.alt = photo.name;
				image.loading = "lazy";
				card.append(image, node("figcaption", "", photo.name));
				grid.append(card);
			}
			section.append(grid);
		} else
			section.append(node("p", "panel-note", "还没有照片，先上传几张吧。"));

		const upload = node("div", "albums-upload");
		const file = node("input");
		file.type = "file";
		file.accept = ".jpg,.jpeg,.png,.webp,.gif,.avif";
		file.multiple = true;
		const asCover = node("input");
		asCover.type = "checkbox";
		const coverLabel = node("label", "", "作为封面（仅 WebP）");
		coverLabel.prepend(asCover);
		const uploadButton = node("button", "button", "上传图片");
		uploadButton.type = "button";
		const uploadNote = node("span", "albums-upload-note", "");
		file.addEventListener("change", () => {
			const count = file.files?.length || 0;
			uploadButton.textContent = count ? `上传图片（${count}）` : "上传图片";
			uploadButton.classList.toggle("is-ready", count > 0);
			uploadNote.textContent = count
				? `已选择 ${count} 个本地文件，点「上传图片」才会写入相册目录。`
				: "";
		});
		uploadButton.addEventListener("click", async () => {
			if (busy || !file.files?.length) return;
			if (asCover.checked && file.files.length > 1) {
				toast("设为封面时请只选择一张图片");
				return;
			}
			busy = true;
			try {
				let index = 0;
				for (const item of file.files) {
					const data = await toBase64(item);
					await api("/api/albums/upload", {
						method: "POST",
						body: JSON.stringify({
							id: album.id,
							name: item.name,
							data,
							asCover: asCover.checked && index === 0,
						}),
					});
					index += 1;
				}
				file.value = "";
				uploadButton.textContent = "上传图片";
				uploadButton.classList.remove("is-ready");
				uploadNote.textContent = "";
				toast(asCover.checked ? "封面已更新" : `已上传 ${index} 张照片`);
				await load(true, true);
			} catch (error) {
				toast(error.message || "上传失败");
			} finally {
				busy = false;
				render();
			}
		});
		const libraryButton = node("button", "button", "从素材库添加");
		libraryButton.type = "button";
		libraryButton.addEventListener("click", async () => {
			if (busy) return;
			let chosen;
			try {
				chosen = await pickMedia({
					usage: `相册「${album.info?.title || album.id}」的图片`,
					initialMode: "library",
				});
			} catch (error) {
				toast(error.message || "打开素材库失败");
				return;
			}
			if (!chosen) return;
			if (chosen.kind !== "local" || !chosen.path) {
				toast("请从素材库选择本地图片，外链图片无法复制进相册");
				return;
			}
			busy = true;
			try {
				await api("/api/albums/import", {
					method: "POST",
					body: JSON.stringify({
						id: album.id,
						path: chosen.path,
						asCover: asCover.checked,
					}),
				});
				toast(asCover.checked ? "封面已更新" : "已从素材库添加照片");
				await load(true, true);
			} catch (error) {
				toast(error.message || "添加失败");
			} finally {
				busy = false;
				render();
			}
		});
		upload.append(file, coverLabel, uploadButton, libraryButton, uploadNote);
		upload.append(
			node(
				"span",
				"field-hint",
				"选择本地文件后需点「上传图片」；右上「保存」只写入上方表单。照片按零填充序号命名（01、02…），封面保存为 cover.webp 且必须是 WebP；「从素材库添加」会把选中图片复制一份到相册目录。上传与导入会保留上方未保存的表单内容，上线仍需「检查与发布」。",
			),
		);
		section.append(upload);
		return section;
	}

	function buildDetail(album) {
		const detail = node("section", "albums-detail");
		const head = node("div", "albums-detail-head");
		head.append(
			node("h3", "", `${album.info?.title || album.id} · ${album.id}`),
		);
		const source = node("button", "button button-small", "查看源文件");
		source.type = "button";
		source.addEventListener("click", () => openSource(album.path));
		head.append(source);
		detail.append(head);
		if (album.infoError)
			detail.append(node("p", "field-hint", album.infoError));
		if (!album.coverPath && album.photos.length)
			detail.append(
				node(
					"p",
					"field-hint",
					"未设置封面：前端会暂用第一张照片展示。建议勾选「作为封面（仅 WebP）」上传一张 WebP。",
				),
			);
		if (album.info?.mode === "external")
			detail.append(
				node(
					"p",
					"field-hint",
					"外链相册（mode: external）的 photos 数组请用「源文件」维护，表单只修改基础信息。",
				),
			);
		form = buildForm(album);
		detail.append(form, buildPhotos(album));
		return detail;
	}

	function render() {
		container.replaceChildren();
		form = null;
		const toolbar = node("div", "albums-toolbar");
		const intro = node("div", "albums-intro");
		const saveState = node(
			"span",
			`albums-save-state${dirty ? " is-dirty" : ""}`,
			dirty ? "表单有未保存的修改" : "表单已保存",
		);
		saveState.dataset.albumsState = "true";
		intro.append(
			node("strong", "", `相册管理 · 共 ${albums.length} 个相册`),
			node(
				"span",
				"",
				"编辑 info.json（有改动时才能保存）；照片与封面上传后立即写入相册目录。",
			),
			saveState,
		);
		toolbar.append(intro);
		const actions = node("div", "albums-actions");
		const createButton = node("button", "button", "＋ 新建相册");
		createButton.type = "button";
		createButton.addEventListener("click", () => {
			creating = !creating;
			render();
		});
		const refresh = node("button", "button", "刷新");
		refresh.type = "button";
		refresh.addEventListener("click", async () => {
			if (dirty && !window.confirm("当前修改尚未保存，仍要刷新吗？")) return;
			try {
				await load(true);
			} catch (error) {
				toast(error.message || "刷新失败");
			}
		});
		const saveButton = node("button", "button button-primary", "保存");
		saveButton.type = "button";
		saveButton.dataset.albumsSave = "true";
		saveButton.disabled = busy;
		saveButton.title = saveHint(dirty);
		saveButton.addEventListener("click", () => void save());
		actions.append(createButton, refresh, saveButton);
		toolbar.append(actions);
		container.append(toolbar);
		if (creating) container.append(buildCreate());
		if (!albums.length) {
			const empty = node("div", "albums-empty");
			empty.append(
				node("strong", "", "还没有相册"),
				node("p", "panel-note", "点击「＋ 新建相册」创建目录与 info.json。"),
			);
			container.append(empty);
			return;
		}
		const layout = node("div", "albums-layout");
		layout.append(buildList());
		const album = current();
		layout.append(album ? buildDetail(album) : node("div", "albums-detail"));
		container.append(layout);
		if (pendingValues) applyValues(pendingValues);
	}

	async function load(keep = true, preserveForm = false) {
		pendingValues = preserveForm && dirty && form ? collect() : null;
		const data = await api("/api/albums");
		albums = Array.isArray(data.albums) ? data.albums : [];
		if (!keep || !albums.some((album) => album.id === selected))
			selected = albums[0]?.id || null;
		render();
		if (pendingValues) setDirty(true);
		else setDirty(false);
	}

	async function save() {
		if (busy) return true;
		if (!dirty) {
			const pending = container.querySelector(
				".albums-upload input[type=file]",
			);
			const count = pending?.files?.length || 0;
			toast(
				count
					? `已选择 ${count} 个本地文件，但还没上传；请点「上传图片」写入相册。表单没有需要保存的修改。`
					: "表单没有改动需要保存；照片与封面已即时写入相册目录",
			);
			return true;
		}
		const album = current();
		if (!album) return true;
		busy = true;
		try {
			await api("/api/albums", {
				method: "PUT",
				body: JSON.stringify({ id: album.id, values: collect() }),
			});
			toast("相册信息已保存到本地");
			await load(true);
			return true;
		} catch (error) {
			toast(error.message || "保存失败");
			return false;
		} finally {
			busy = false;
			render();
		}
	}

	return {
		load,
		save,
		hasDirty: () => dirty,
		destroy() {
			container.replaceChildren();
		},
	};
}
