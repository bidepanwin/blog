/**
 * Visual editor for src/data/anime.ts and src/data/books.ts.
 * Mounted by app.js when one of those files is opened in "structured" mode.
 * The API owns parsing/serialisation; this module only edits plain objects.
 */

const node = (tag, className, text) => {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text !== undefined) element.textContent = String(text);
	return element;
};

const statusLabel = (statuses, value) =>
	statuses.find((status) => status.value === value)?.label || value || "未设置";

const listValue = (value) =>
	Array.isArray(value) ? value.join(", ") : String(value ?? "");

function defaults(data) {
	const result = { title: "" };
	if (data.statuses?.length) result.status = data.statuses[0].value;
	if (data.fields.some((field) => field.key === "rating")) result.rating = 0;
	if (data.fields.some((field) => field.key === "genres")) result.genres = [];
	return result;
}

export function mountCollectionEditor({
	container,
	data,
	onChange,
	chooseImage,
	resolveCover,
	mediaUrl,
	openSource,
	initialExpanded = null,
}) {
	let items = structuredClone(data.items);
	let comments = structuredClone(data.comments || []);
	let tailComments = structuredClone(data.tailComments || []);
	let coverPaths = [...(data.coverPaths || [])];
	let expanded = initialExpanded === null ? null : Number(initialExpanded);
	let showAdvanced = false;
	let destroyed = false;

	const groups = [];
	for (const field of data.fields) {
		let group = groups.find((entry) => entry.name === field.group);
		if (!group) {
			group = { name: field.group, fields: [] };
			groups.push(group);
		}
		group.fields.push(field);
	}

	function ensureLists() {
		while (comments.length < items.length) comments.push([]);
		comments.length = items.length;
		while (coverPaths.length < items.length) coverPaths.push(null);
		coverPaths.length = items.length;
	}

	function labelFor(item, index) {
		const parts = [];
		if (item.year || item.yearPublished)
			parts.push(item.year || item.yearPublished);
		if (item.studio || item.author) parts.push(item.studio || item.author);
		return parts.length
			? parts.join(" · ")
			: `第 ${index + 1} 条`;
	}

	function thumbnail(item, index) {
		const wrapper = node("div", "collection-thumb");
		const path = coverPaths[index];
		if (path) {
			const image = node("img", "collection-thumb-image");
			image.src = mediaUrl(path);
			image.alt = item.title ? `${item.title} 的封面` : "封面预览";
			image.loading = "lazy";
			image.referrerPolicy = "no-referrer";
			image.addEventListener("error", () => {
				image.hidden = true;
				wrapper.append(node("span", "collection-thumb-empty", "无图"));
			});
			wrapper.append(image);
		} else wrapper.append(node("span", "collection-thumb-empty", "占位"));
		return wrapper;
	}

	function fieldRow(field, item, index, form) {
		if (field.advanced && !showAdvanced) return null;
		const wrapper = node(
			"div",
			`field collection-field ${field.width === "full" ? "field-wide" : ""}`,
		);
		const title = node("span", "setting-label", field.label + (field.required ? " *" : ""));
		wrapper.append(title);

		let input;
		if (field.type === "text" || field.type === "comment") {
			input = node("textarea");
			input.rows = field.type === "comment" ? 2 : 3;
		} else if (field.type === "status") {
			input = node("select");
			for (const status of data.statuses) {
				const option = node("option", "", status.label);
				option.value = status.value;
				input.append(option);
			}
		} else if (field.type === "boolean") {
			input = node("input");
			input.type = "checkbox";
			input.className = "collection-checkbox";
		} else {
			input = node("input");
			input.type =
				field.type === "number" || field.type === "rating"
					? "number"
					: "text";
		}
		input.dataset.key = field.key;
		input.dataset.index = String(index);
		input.autocomplete = "off";
		if (field.placeholder) input.placeholder = field.placeholder;
		if (field.type === "rating") {
			input.min = "0";
			input.max = "10";
			input.step = "0.5";
		}
		if (field.type === "number") {
			input.min = "0";
			input.max = "100";
			input.step = "1";
		}

		if (field.type === "pair") {
			const pair = node("div", "collection-pair");
			for (const sub of field.subfields) {
				const subLabel = node("label", "collection-subfield");
				subLabel.append(node("span", "", sub.label));
				const subInput = node("input");
				subInput.type = sub.type === "number" ? "number" : "text";
				subInput.dataset.key = field.key;
				subInput.dataset.sub = sub.key;
				subInput.dataset.index = String(index);
				subInput.autocomplete = "off";
				if (sub.placeholder) subInput.placeholder = sub.placeholder;
				const current = item[field.key];
				if (current && typeof current === "object")
					subInput.value = String(current[sub.key] ?? "");
				subLabel.append(subInput);
				pair.append(subLabel);
			}
			wrapper.append(pair);
		} else if (field.type === "image") {
			const row = node("div", "image-field-row");
			input.value = String(item[field.key] ?? "");
			const button = node("button", "button button-small", "选择图片");
			button.type = "button";
			button.addEventListener("click", async () => {
				if (destroyed) return;
				try {
					const reference = await chooseImage(input.value, field.label);
					if (reference === null || reference === undefined || destroyed)
						return;
					input.value = reference;
					items[index][field.key] = reference;
					const path = await resolveCover(reference);
					if (destroyed) return;
					coverPaths[index] = path;
					const card = container.querySelector(
						`.collection-card[data-index="${index}"]`,
					);
					const thumb = card?.querySelector(".collection-thumb");
					if (thumb) thumb.replaceWith(thumbnail(items[index], index));
					const preview = form.querySelector(".collection-image-preview");
					if (preview) {
						preview.replaceChildren();
						if (path) {
							const image = node("img");
							image.src = mediaUrl(path);
							image.alt = "所选封面预览";
							preview.append(image);
						} else preview.append(node("span", "", "暂无预览"));
					}
					onChange();
				} catch (error) {
					window.alert(error.message || "选择图片失败。");
				}
			});
			row.append(input, button);
			wrapper.append(row);
			const preview = node("div", "collection-image-preview");
			if (coverPaths[index]) {
				const image = node("img");
				image.src = mediaUrl(coverPaths[index]);
				image.alt = "所选封面预览";
				preview.append(image);
			} else preview.append(node("span", "", "暂无预览"));
			wrapper.append(preview);
		} else {
			if (field.type === "comment")
				input.value = (comments[index] || []).join("\n");
			else if (field.type === "list") input.value = listValue(item[field.key]);
			else if (field.type === "boolean")
				input.checked = item[field.key] === true;
			else input.value = String(item[field.key] ?? "");
			wrapper.append(input);
		}

		if (field.help) wrapper.append(node("span", "field-hint", field.help));
		return wrapper;
	}

	function syncInput(target, index, form) {
		if (destroyed) return;
		const key = target.dataset.key;
		const item = items[index];
		if (!key || !item) return;
		const field = data.fields.find((entry) => entry.key === key);
		if (!field) return;
		if (field.type === "pair") {
			const value = {};
			for (const sub of field.subfields) {
				const subInput = form.querySelector(
					`[data-index="${index}"][data-key="${key}"][data-sub="${sub.key}"]`,
				);
				const raw = subInput?.value.trim() ?? "";
				if (!raw) continue;
				value[sub.key] = sub.type === "number" ? Number(raw) : raw;
			}
			if (Object.keys(value).length) item[key] = value;
			else delete item[key];
			return;
		}
		if (field.type === "comment") {
			comments[index] = target.value
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			return;
		}
		if (field.type === "list") {
			item[key] = target.value
				.split(/[,，]/)
				.map((entry) => entry.trim())
				.filter(Boolean);
			return;
		}
		if (field.type === "boolean") {
			if (target.checked) item[key] = true;
			else delete item[key];
			return;
		}
		const raw = target.value;
		if (raw === "" && !field.required) {
			delete item[key];
		} else if (field.type === "number" || field.type === "rating") {
			item[key] = raw === "" ? 0 : Number(raw);
		} else item[key] = raw;

		if (key === "title" || key === "status" || key === "year" || key === "author" || key === "studio" || key === "yearPublished") {
			const card = container.querySelector(
				`.collection-card[data-index="${index}"]`,
			);
			const heading = card?.querySelector(".collection-card-title");
			if (heading) heading.textContent = item.title || "未命名条目";
			const meta = card?.querySelector(".collection-card-meta");
			if (meta) meta.textContent = labelFor(item, index);
			const chip = card?.querySelector(".collection-status");
			if (chip && data.statuses?.length)
				chip.textContent = statusLabel(data.statuses, item.status);
		}
	}

	function buildForm(item, index) {
		const form = node("form", "collection-form");
		form.addEventListener("submit", (event) => event.preventDefault());
		form.addEventListener("input", (event) => {
			const target = event.target;
			if (!target?.dataset?.key) return;
			syncInput(target, index, form);
			onChange();
		});
		for (const group of groups) {
			const visible = group.fields.filter(
				(field) => !field.advanced || showAdvanced,
			);
			if (!visible.length) continue;
			const section = node("section", "collection-group");
			section.append(node("h4", "collection-group-title", group.name));
			const grid = node("div", "collection-grid");
			for (const field of visible) {
				const row = fieldRow(field, item, index, form);
				if (row) grid.append(row);
			}
			section.append(grid);
			form.append(section);
		}
		return form;
	}

	function cardFor(item, index) {
		const card = node("article", "collection-card");
		card.dataset.index = String(index);
		const isOpen = expanded === index;
		if (isOpen) card.classList.add("is-expanded");
		const header = node("div", "collection-card-header");
		const toggle = node("button", "collection-card-toggle");
		toggle.type = "button";
		toggle.setAttribute("aria-expanded", String(isOpen));
		toggle.append(thumbnail(item, index));
		const copy = node("div", "collection-card-copy");
		copy.append(
			node("strong", "collection-card-title", item.title || "未命名条目"),
			node("span", "collection-card-meta", labelFor(item, index)),
		);
		const chips = node("div", "collection-chips");
		if (data.statuses?.length)
			chips.append(
				node("span", "collection-status", statusLabel(data.statuses, item.status)),
			);
		if (Number(item.rating) > 0)
			chips.append(node("span", "collection-rating", `★ ${item.rating}`));
		if (!item.cover)
			chips.append(node("span", "collection-warning", "无封面"));
		copy.append(chips);
		toggle.append(copy);
		toggle.addEventListener("click", () => {
			expanded = isOpen ? null : index;
			render();
			if (expanded !== null)
				container
					.querySelector(`.collection-card[data-index="${expanded}"]`)
					?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
		header.append(toggle);
		const actions = node("div", "collection-card-actions");
		for (const [label, title, handler] of [
			["↑", "上移", () => move(index, -1)],
			["↓", "下移", () => move(index, 1)],
			["删除", "删除此条目", () => remove(index)],
		]) {
			const button = node(
				"button",
				label === "删除" ? "button button-small button-danger-quiet" : "icon-button collection-move",
				label,
			);
			button.type = "button";
			button.title = title;
			button.setAttribute("aria-label", `${title}：${item.title || "未命名条目"}`);
			button.disabled = (label === "↑" && index === 0) ||
				(label === "↓" && index === items.length - 1);
			button.addEventListener("click", handler);
			actions.append(button);
		}
		header.append(actions);
		card.append(header);
		if (isOpen) card.append(buildForm(item, index));
		return card;
	}

	function move(index, offset) {
		const target = index + offset;
		if (target < 0 || target >= items.length) return;
		[items[index], items[target]] = [items[target], items[index]];
		[comments[index], comments[target]] = [comments[target], comments[index]];
		[coverPaths[index], coverPaths[target]] = [
			coverPaths[target],
			coverPaths[index],
		];
		expanded = target;
		onChange();
		render();
	}

	function remove(index) {
		const name = items[index].title || "未命名条目";
		if (!window.confirm(`确定删除「${name}」吗？保存前还可以放弃修改恢复。`))
			return;
		items.splice(index, 1);
		comments.splice(index, 1);
		coverPaths.splice(index, 1);
		if (expanded === index) expanded = null;
		else if (expanded !== null && expanded > index) expanded -= 1;
		onChange();
		render();
	}

	function add() {
		items.push(defaults(data));
		comments.push([]);
		coverPaths.push(null);
		expanded = items.length - 1;
		onChange();
		render();
		const card = container.querySelector(
			`.collection-card[data-index="${expanded}"]`,
		);
		const input = card?.querySelector('[data-key="title"]');
		input?.focus();
		card?.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	function render() {
		if (destroyed) return;
		ensureLists();
		container.replaceChildren();
		const toolbar = node("div", "collection-toolbar");
		const intro = node("div", "collection-intro");
		intro.append(
			node("strong", "", `${data.label} · 共 ${items.length} 个条目`),
			node(
				"span",
				"",
				`点击卡片展开编辑；改动会写入 ${data.path}，保存后仍需「发布」才会上线。`,
			),
		);
		toolbar.append(intro);
		const tools = node("div", "collection-tools");
		const advanced = data.fields.some((field) => field.advanced);
		if (advanced) {
			const button = node(
				"button",
				"button button-small",
				showAdvanced ? "隐藏高级字段" : "显示高级字段",
			);
			button.type = "button";
			button.addEventListener("click", () => {
				showAdvanced = !showAdvanced;
				render();
			});
			tools.append(button);
		}
		const source = node("button", "button button-small", "查看源文件");
		source.type = "button";
		source.addEventListener("click", () => openSource());
		tools.append(source);
		const addButton = node("button", "button button-primary", "＋ 新增条目");
		addButton.type = "button";
		addButton.addEventListener("click", add);
		tools.append(addButton);
		toolbar.append(tools);
		container.append(toolbar);

		if (!items.length) {
			const empty = node("div", "collection-empty");
			empty.append(
				node("div", "collection-empty-symbol", "＋"),
				node("strong", "", `还没有${data.itemLabel}条目`),
				node("p", "", "点击「新增条目」开始，或用「查看源文件」手动编写。"),
			);
			container.append(empty);
			return;
		}
		const list = node("div", "collection-list");
		for (let index = 0; index < items.length; index += 1)
			list.append(cardFor(items[index], index));
		container.append(list);
		const footer = node("div", "collection-footer");
		const addMore = node("button", "button", "＋ 在末尾新增一条");
		addMore.type = "button";
		addMore.addEventListener("click", add);
		footer.append(
			addMore,
			node("span", "field-hint", "提示：Ctrl / ⌘ + S 保存；未保存时离开会提示。"),
		);
		container.append(footer);
	}

	function collect() {
		if (expanded !== null) {
			const form = container.querySelector(
				`.collection-card[data-index="${expanded}"] .collection-form`,
			);
			if (form)
				for (const input of form.querySelectorAll("[data-key]"))
					syncInput(input, expanded, form);
		}
		return {
			items: structuredClone(items),
			comments: structuredClone(comments),
			tailComments: structuredClone(tailComments),
		};
	}

	return {
		collect,
		render,
		getExpanded: () => expanded,
		destroy() {
			destroyed = true;
			container.replaceChildren();
		},
	};
}
