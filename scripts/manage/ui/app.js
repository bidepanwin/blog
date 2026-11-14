(() => {
	const $ = (id) => document.getElementById(id);
	const token =
		document.querySelector('meta[name="manager-token"]')?.content || "";
	const sections = {
		content: [
			"CONTENT",
			"文章与笔记",
			"在这里记录想法，维护博客的每一篇内容。",
		],
		pages: ["PAGES", "独立页面", "编辑关于、留言说明等独立页面。"],
		data: [
			"COLLECTIONS",
			"书单与数据",
			"维护书单、友链、相册以及其他数据内容。",
		],
		settings: [
			"PERSONALIZE",
			"站点设置",
			"从站名到首页动效，让博客成为你的样子。",
		],
		media: [
			"MEDIA LIBRARY",
			"图片素材",
			"把喜欢的画面放进文字，复制引用即可使用。",
		],
		publish: [
			"SHIP YOUR IDEAS",
			"检查与发布",
			"确认本地修改，再把新的内容带到线上。",
		],
		history: [
			"LOCAL BACKUPS",
			"备份与恢复",
			"每一次保存都有迹可循，需要时可以恢复。",
		],
	};
	const state = {
		files: [],
		media: [],
		git: {},
		group: "content",
		current: null,
		mode: "structured",
		dirty: false,
		editVersion: 0,
		saving: false,
		loading: false,
		loadGeneration: 0,
		previewGeneration: 0,
		previewVisible: true,
		settingsList: false,
		job: null,
		previewTimer: null,
		previewAbort: null,
		toastTimer: null,
	};
	const knownLabels = {
		title: "站点标题",
		subtitle: "站点副标题",
		name: "名称",
		bio: "个人简介",
		description: "描述",
		lang: "语言",
		site: "站点地址",
		base: "部署路径",
		avatar: "头像",
		"banner.homeText.title": "首页大标题",
		"banner.homeText.subtitle": "首页副标题",
		"banner.homeText.enable": "显示首页文字",
		"banner.homeText.typewriter.enable": "启用逐字动画",
		"banner.homeText.typewriter.includeTitle": "大标题参与逐字动画",
		"banner.homeText.typewriter.speed": "打字间隔（毫秒）",
		"banner.homeText.typewriter.deleteSpeed": "删除间隔（毫秒）",
		"banner.homeText.typewriter.pauseTime": "停留时间（毫秒）",
		"banner.homeText.typewriter.loop": "循环播放逐字动画",
		"banner.contextText.typewriter.enable": "栏目页启用逐字动画",
		"banner.contextText.typewriter.includeTitle": "栏目页大标题参与逐字动画",
		"banner.contextText.typewriter.speed": "栏目页打字间隔（毫秒）",
		"banner.contextText.typewriter.deleteSpeed": "栏目页删除间隔（毫秒）",
		"banner.contextText.typewriter.pauseTime": "栏目页文字停留时间（毫秒）",
		"banner.contextText.typewriter.loop": "栏目页循环打字",
		"banner.mobileOnAllPages": "栏目页也显示手机横幅",
		"banner.carousel.enable": "启用背景轮播",
		"banner.carousel.interval": "轮播间隔（毫秒）",
		"banner.dim.enable": "启用背景遮罩",
		"banner.dim.opacity": "遮罩深度（0 到 1）",
		"banner.waves.enable": "显示背景波浪",
		"banner.position": "背景位置",
		"themeColor.hue": "主题色相",
		"themeColor.defaultStyle": "默认配色风格",
		"themeColor.defaultSpec": "默认配色规范",
		"wallpaperMode.defaultMode": "默认背景模式",
	};
	const bannerPageLabels = {
		archive: "归档页",
		reports: "札记页",
		moments: "随记页",
		anime: "番剧页",
		books: "书单页",
		thinking: "思考页",
		graph: "知识图谱页",
		wiki: "知识库页",
		albums: "相册页",
		friends: "友链页",
		projects: "项目页",
		about: "关于页",
	};
	function settingLabel(key) {
		const pageImage =
			/^banner\.pageImages\.([^.]+)\.(desktop|mobile|dimOpacity)$/.exec(key);
		if (pageImage && bannerPageLabels[pageImage[1]]) {
			if (pageImage[2] === "dimOpacity")
				return `${bannerPageLabels[pageImage[1]]}横幅遮罩深度（0 到 1）`;
			return `${bannerPageLabels[pageImage[1]]}${pageImage[2] === "desktop" ? "电脑" : "手机"}横幅`;
		}
		return knownLabels[key] || key.split(".").pop();
	}

	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = String(text);
		return node;
	}
	function formatSize(bytes) {
		if (!Number.isFinite(bytes)) return "";
		return bytes < 1024
			? bytes + " B"
			: bytes < 1048576
				? (bytes / 1024).toFixed(1) + " KB"
				: (bytes / 1048576).toFixed(1) + " MB";
	}
	function formatDate(value) {
		if (!value) return "";
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? String(value)
			: date.toLocaleString("zh-CN", {
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				});
	}
	function fileName(path) {
		return path.split("/").pop() || path;
	}
	function classify(file) {
		const path = file.path.replaceAll("\\", "/");
		if (path.startsWith("src/content/spec/")) return "pages";
		if (path.startsWith("src/content/")) return "content";
		if (path.startsWith("src/config/")) return "settings";
		if (path.startsWith("src/data/")) return "data";
		const group = String(file.group || "").toLowerCase();
		return ["content", "pages", "data", "settings"].includes(group)
			? group
			: "data";
	}
	function showError(message) {
		$("error-text").textContent = message;
		$("error-banner").hidden = false;
	}
	function clearError() {
		$("error-banner").hidden = true;
	}
	function toast(message) {
		clearTimeout(state.toastTimer);
		$("toast").textContent = message;
		$("toast").hidden = false;
		state.toastTimer = setTimeout(() => {
			$("toast").hidden = true;
		}, 3500);
	}
	async function api(path, options = {}) {
		const response = await fetch(path, {
			...options,
			cache: "no-store",
			credentials: "same-origin",
			headers: {
				"X-Manager-Token": token,
				...(options.body ? { "Content-Type": "application/json" } : {}),
				...options.headers,
			},
		});
		const text = await response.text();
		let data;
		try {
			data = text ? JSON.parse(text) : {};
		} catch {
			data = {};
		}
		if (!response.ok) {
			let message = typeof data.error === "string" ? data.error : data.message;
			if (response.status === 409)
				message =
					"保存冲突：文件已被其他窗口或程序修改。请先复制当前文字，再刷新文件，避免覆盖新版本。" +
					(message ? " " + message : "");
			if (response.status === 401 || response.status === 403)
				message =
					message || "本地管理凭证失效，请从启动时显示的地址重新打开管理台。";
			const error = new Error(
				message ||
					"请求失败（" + response.status + "），请查看本地终端或重试。",
			);
			error.status = response.status;
			throw error;
		}
		return data;
	}
	function handleError(error) {
		if (error.name === "AbortError") return;
		showError(error.message || "无法连接本地服务，请确认管理台仍在运行。");
	}
	function updateDirty(dirty = true) {
		state.dirty = dirty;
		if (dirty) state.editVersion += 1;
		$("dirty-badge").hidden = !dirty;
		$("save-button").disabled =
			!state.current ||
			!dirty ||
			state.saving ||
			state.loading ||
			Boolean(state.job);
		document.title =
			(dirty ? "● " : "") +
			(state.current ? fileName(state.current.path) + " · " : "") +
			"林间本地管理台";
		if (dirty) $("save-status").textContent = "尚未保存到本地";
		updateDraftNotice();
	}
	function updateDraftNotice() {
		const current = state.current;
		const supported =
			current?.document &&
			/^src\/content\/(posts|moments|reports)\//.test(current.path);
		const savedDraft = current?.document?.frontmatter?.draft === true;
		const structured = state.mode === "structured";
		const editingDraft = structured && supported && $("meta-draft").checked;
		$("draft-notice").hidden = !supported || (!savedDraft && !editingDraft);
		if ($("draft-notice").hidden) return;
		if (structured && !editingDraft) {
			$("draft-notice-title").textContent = "已取消草稿，请先保存";
			$("draft-notice-text").textContent =
				"本地文件仍是草稿。先点击“保存”，再点击顶栏“发布”，在发布面板检查并提交后才会上线。";
			return;
		}
		$("draft-notice-title").textContent = structured
			? "草稿，发布后仍不公开"
			: "已保存版本为草稿，发布后仍不公开";
		$("draft-notice-text").textContent = structured
			? "要让这篇内容显示在博客，请取消“草稿”并保存，再点击顶栏“发布”，在发布面板检查并提交。草稿只隐藏网站展示，公开仓库中的源文件仍可见。"
			: "如需公开，请将源文件中的 draft 改为 false 并保存，或切回“内容编辑”取消“草稿”。然后点击顶栏“发布”，在面板检查并提交。公开仓库中的源文件仍可见。";
	}
	function mayDiscard() {
		return (
			!state.dirty ||
			window.confirm("当前文件有未保存的修改。确定放弃这些修改吗？")
		);
	}
	function setSidebar(open) {
		document.body.classList.toggle("sidebar-open", open);
		$("sidebar-backdrop").hidden = !open;
		$("menu-button").setAttribute("aria-expanded", String(open));
	}

	async function refreshState(quiet = false) {
		try {
			const data = await api("/api/state");
			state.files = Array.isArray(data.files) ? data.files : [];
			state.media = Array.isArray(data.media) ? data.media : [];
			state.git = data.git || {};
			if (data.previewUrl) $("local-preview-link").href = data.previewUrl;
			if (data.siteUrl) {
				$("site-link").href = data.siteUrl;
				$("published-site-link").href = data.siteUrl;
			}
			$("connection-dot").classList.add("is-connected");
			$("connection-label").textContent = "本地服务已连接";
			document.querySelectorAll("[data-count]").forEach((badge) => {
				const group = badge.dataset.count;
				badge.textContent = String(
					group === "media"
						? state.media.length
						: state.files.filter((file) => classify(file) === group).length,
				);
			});
			renderFiles();
			renderPublish();
			if (state.group === "media") renderMedia();
			if (state.group === "settings") renderSettingsShortcuts();
			if (!quiet) clearError();
			return true;
		} catch (error) {
			$("connection-dot").classList.remove("is-connected");
			$("connection-label").textContent = "本地服务未连接";
			handleError(error);
			return false;
		}
	}

	function renderFiles() {
		const query = $("file-search").value.trim().toLowerCase();
		const collection = $("collection-filter").value;
		const items = state.files
			.filter(
				(file) =>
					classify(file) === state.group &&
					(!query || file.path.toLowerCase().includes(query)) &&
					(state.group !== "content" ||
						!collection ||
						file.path.startsWith("src/content/" + collection + "/")),
			)
			.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
		$("file-list").replaceChildren();
		for (const file of items) {
			const button = element(
				"button",
				"file-item" + (state.current?.path === file.path ? " is-active" : ""),
			);
			button.type = "button";
			button.setAttribute(
				"aria-pressed",
				String(state.current?.path === file.path),
			);
			const name = element(
				"span",
				"file-item-name",
				fileName(file.path).replace(/\.mdx?$/, ""),
			);
			const path = element(
				"span",
				"file-item-path",
				file.path.replace(/^src\/(content|config|data)\//, ""),
			);
			const info = element(
				"span",
				"file-item-info",
				[formatDate(file.modifiedAt), formatSize(file.size)]
					.filter(Boolean)
					.join(" · "),
			);
			button.append(name, path, info);
			button.addEventListener("click", () => {
				void openFile(file.path);
			});
			$("file-list").append(button);
		}
		if (!items.length)
			$("file-list").append(
				element(
					"p",
					"list-empty",
					query ? "没有找到匹配的文件。" : "这个分类还没有文件。",
				),
			);
		$("file-total").textContent = items.length + " 个文件";
	}

	async function selectGroup(group) {
		if (
			!sections[group] ||
			(group === state.group && !(group === "settings" && state.settingsList))
		)
			return;
		if (!mayDiscard()) return;
		state.loadGeneration += 1;
		state.group = group;
		state.current = null;
		state.settingsList = false;
		updateDirty(false);
		clearError();
		setSidebar(false);
		const [eyebrow, title, description] = sections[group];
		$("section-eyebrow").textContent = eyebrow;
		$("section-title").textContent = title;
		$("section-description").textContent = description;
		document.querySelectorAll("[data-group]").forEach((button) => {
			const active = button.dataset.group === group;
			button.classList.toggle("is-active", active);
			if (active) button.setAttribute("aria-current", "page");
			else button.removeAttribute("aria-current");
		});
		$("history-button").classList.toggle("is-active", group === "history");
		$("new-button").hidden = !["content", "pages"].includes(group);
		$("editor-workspace").hidden = !["content", "pages", "data"].includes(
			group,
		);
		for (const name of ["settings", "media", "publish", "history"])
			$(name + "-panel").hidden = name !== group;
		$("editor-content").hidden = true;
		$("editor-empty").hidden = false;
		$("file-search").value = "";
		$("collection-filter").hidden = group !== "content";
		document.querySelector(".collection-label").hidden = group !== "content";
		renderFiles();
		if (group === "settings") renderSettingsShortcuts();
		if (group === "media") renderMedia();
		if (group === "publish") {
			await refreshState(true);
			renderPublish();
		}
		if (group === "history") await loadHistory();
	}

	async function openFile(path, options = {}) {
		if (!options.force && state.current?.path === path && !state.dirty) return;
		if (!options.force && !mayDiscard()) return;
		const generation = ++state.loadGeneration;
		state.loading = true;
		$("save-button").disabled = true;
		clearError();
		try {
			const raw = await api("/api/file?path=" + encodeURIComponent(path));
			let documentData = null;
			let settingsData = null;
			if (/\.mdx?$/.test(path))
				documentData = await api(
					"/api/document?path=" + encodeURIComponent(path),
				);
			else if (path.startsWith("src/config/") && path.endsWith(".ts")) {
				try {
					settingsData = await api(
						"/api/settings?path=" + encodeURIComponent(path),
					);
				} catch (error) {
					if (error.status !== 400 && error.status !== 422) throw error;
				}
			}
			if (generation !== state.loadGeneration) return;
			state.current = {
				...raw,
				path,
				document: documentData,
				fields: Array.isArray(settingsData?.fields)
					? settingsData.fields
					: null,
				settingsHash: settingsData?.hash || raw.hash,
			};
			state.mode =
				options.mode ||
				(documentData || settingsData?.fields?.length
					? "structured"
					: "source");
			if (state.group === "settings") {
				$("settings-panel").hidden = true;
				$("editor-workspace").hidden = false;
				state.settingsList = true;
			}
			$("editor-name").textContent = fileName(path);
			$("editor-path").textContent = path;
			$("editor-empty").hidden = true;
			$("editor-content").hidden = false;
			applyEditor();
			updateDirty(false);
			$("save-status").textContent = "已从本地文件载入";
			renderFiles();
		} catch (error) {
			if (generation === state.loadGeneration) handleError(error);
		} finally {
			if (generation === state.loadGeneration) {
				state.loading = false;
				updateDirty(state.dirty);
			}
		}
	}

	function applyEditor() {
		const current = state.current;
		if (!current) return;
		const structured = state.mode === "structured";
		const isDocument = Boolean(current.document) && structured;
		const isSettings = Boolean(current.fields?.length) && structured;
		$("form-mode").hidden = !current.document && !current.fields?.length;
		$("form-mode").classList.toggle("is-selected", structured);
		$("form-mode").setAttribute("aria-pressed", String(structured));
		$("source-mode").classList.toggle("is-selected", !structured);
		$("source-mode").setAttribute("aria-pressed", String(!structured));
		$("metadata-form").hidden = !isDocument;
		$("settings-fields").hidden = !isSettings;
		$("body-editor").hidden = isSettings;
		$("body-label").hidden = isSettings;
		$("body-label").textContent = structured ? "Markdown 正文" : "源文件内容";
		$("editor-help").textContent = isSettings
			? "这些字段直接来自配置文件。未展示的表达式与其他代码会保留；高级修改可切换到源文件。"
			: structured
				? "支持 Markdown。Ctrl / ⌘ + S 保存，Tab 插入缩进；其他元字段会原样保留。"
				: "直接编辑原始文件。Ctrl / ⌘ + S 保存，Tab 插入缩进；修改配置后请运行检查。";
		if (isDocument) {
			const frontmatter = current.document.frontmatter || {};
			const supportsDraft = /^src\/content\/(posts|moments|reports)\//.test(
				current.path,
			);
			const supportsPinned = /^src\/content\/(posts|moments)\//.test(
				current.path,
			);
			$("meta-draft").parentElement.hidden = !supportsDraft;
			$("meta-pinned").parentElement.hidden = !supportsPinned;
			for (const key of [
				"title",
				"published",
				"category",
				"description",
				"image",
			]) {
				let value = frontmatter[key];
				if (key === "published" && typeof value === "string")
					value = value.replace(/T00:00:00(?:\.000)?Z$/, "");
				$("meta-" + key).value =
					value === undefined || value === null ? "" : String(value);
			}
			$("meta-tags").value = Array.isArray(frontmatter.tags)
				? frontmatter.tags.join(", ")
				: String(frontmatter.tags || "");
			$("meta-draft").checked = frontmatter.draft === true;
			$("meta-pinned").checked = frontmatter.pinned === true;
			$("body-editor").value = current.document.body || "";
		} else if (isSettings) renderSettingsFields();
		else $("body-editor").value = current.content || "";
		const canPreview = Boolean(current.document) && structured;
		$("preview-toggle").hidden = !canPreview;
		$("preview-column").hidden = !canPreview || !state.previewVisible;
		$("edit-layout").classList.toggle(
			"has-preview",
			canPreview && state.previewVisible,
		);
		$("preview-toggle").setAttribute(
			"aria-pressed",
			String(state.previewVisible),
		);
		$("preview-toggle").textContent = state.previewVisible
			? "隐藏预览"
			: "显示预览";
		countCharacters();
		if (canPreview) schedulePreview();
	}

	function renderSettingsFields() {
		$("settings-fields").replaceChildren();
		for (const field of state.current.fields) {
			const label = element(
				"label",
				"field" + (field.type === "boolean" ? " settings-boolean" : ""),
			);
			const title = element("span", "setting-label", settingLabel(field.key));
			const key = element("span", "setting-key", field.key);
			const array = Array.isArray(field.value) || field.type === "string[]";
			const input = element(array ? "textarea" : "input");
			input.dataset.setting = field.key;
			input.dataset.valueType = array ? "array" : field.type;
			if (!array)
				input.type =
					field.type === "boolean"
						? "checkbox"
						: field.type === "number"
							? "number"
							: "text";
			if (field.type === "number") input.step = "any";
			if (field.type === "boolean") input.checked = field.value === true;
			else
				input.value = array
					? field.value.join("\n")
					: String(field.value ?? "");
			if (array) input.rows = Math.min(Math.max(field.value.length, 2), 6);
			if (field.type === "boolean") {
				const copy = element("span", "setting-copy");
				copy.append(title, key);
				label.append(copy, input);
			} else label.append(title, key, input);
			input.addEventListener("input", () => updateDirty());
			$("settings-fields").append(label);
		}
	}

	function collectFrontmatter() {
		const original = state.current.document.frontmatter || {};
		const next = { ...original };
		for (const key of [
			"title",
			"published",
			"category",
			"description",
			"image",
		]) {
			const value = $("meta-" + key).value;
			if (value || Object.hasOwn(original, key)) next[key] = value;
		}
		const tags = $("meta-tags")
			.value.split(/[,，]/)
			.map((tag) => tag.trim())
			.filter(Boolean);
		if (tags.length || Object.hasOwn(original, "tags")) next.tags = tags;
		for (const key of ["draft", "pinned"]) {
			if ($("meta-" + key).parentElement.hidden) continue;
			if ($("meta-" + key).checked || Object.hasOwn(original, key))
				next[key] = $("meta-" + key).checked;
		}
		return next;
	}

	async function saveCurrent() {
		const current = state.current;
		if (!current || !state.dirty || state.saving || state.job)
			return !state.dirty;
		state.saving = true;
		const version = state.editVersion;
		const structured = state.mode === "structured";
		let endpoint = "/api/file";
		let method = "PUT";
		let payload = {
			path: current.path,
			hash: current.hash,
			content: $("body-editor").value,
		};
		if (structured && current.document) {
			endpoint = "/api/document";
			payload = {
				path: current.path,
				hash: current.hash,
				frontmatter: collectFrontmatter(),
				body: $("body-editor").value,
			};
		} else if (structured && current.fields?.length) {
			endpoint = "/api/settings";
			method = "PATCH";
			const values = {};
			for (const input of $("settings-fields").querySelectorAll(
				"[data-setting]",
			)) {
				const type = input.dataset.valueType;
				const value =
					type === "boolean"
						? input.checked
						: type === "number"
							? Number(input.value)
							: type === "array"
								? input.value
										.split("\n")
										.map((line) => line.trim())
										.filter(Boolean)
								: input.value;
				if (
					type === "number" &&
					(input.value.trim() === "" || !Number.isFinite(value))
				) {
					showError(
						"数值字段不能为空，且必须是有效数字：" + input.dataset.setting,
					);
					state.saving = false;
					updateDirty(state.dirty);
					return false;
				}
				values[input.dataset.setting] = value;
			}
			payload = {
				path: current.path,
				hash: current.settingsHash || current.hash,
				values,
			};
		}
		$("save-button").disabled = true;
		$("save-button").firstChild.textContent = "保存中";
		$("save-status").textContent = "正在写入本地文件…";
		clearError();
		try {
			let saved = await api(endpoint, {
				method,
				body: JSON.stringify(payload),
			});
			if (!saved.hash)
				saved = await api("/api/file?path=" + encodeURIComponent(current.path));
			let savedDocument = null;
			if (endpoint === "/api/file" && current.document) {
				try {
					savedDocument = await api(
						"/api/document?path=" + encodeURIComponent(current.path),
					);
				} catch {
					showError(
						"文件已保存到本地，但草稿状态未能刷新。请重新打开文件确认草稿状态后再发布。",
					);
				}
			}
			if (state.current === current) {
				current.hash = saved.hash;
				current.settingsHash = saved.hash;
				if (typeof saved.content === "string") current.content = saved.content;
				else if (endpoint === "/api/file") current.content = payload.content;
				if (endpoint === "/api/document")
					current.document = {
						...current.document,
						frontmatter: payload.frontmatter,
						body: payload.body,
					};
				else if (savedDocument) current.document = savedDocument;
				if (state.editVersion === version) updateDirty(false);
				$("save-status").textContent = state.dirty
					? "已保存；还有新的修改未保存"
					: "已保存到本地 · " + new Date().toLocaleTimeString("zh-CN");
			}
			await refreshState(true);
			toast("已保存到本地，发布后才会更新线上。");
			return true;
		} catch (error) {
			handleError(error);
			$("save-status").textContent = "保存失败，编辑内容仍保留";
			return false;
		} finally {
			state.saving = false;
			$("save-button").firstChild.textContent = "保存";
			updateDirty(state.dirty);
		}
	}

	async function switchMode(mode) {
		if (!state.current || mode === state.mode) return;
		if (state.dirty) {
			if (!window.confirm("切换编辑模式前需要先保存当前修改。保存并切换吗？"))
				return;
			if (!(await saveCurrent())) return;
		}
		await openFile(state.current.path, { force: true, mode });
	}
	function countCharacters() {
		$("character-count").textContent =
			$("body-editor").value.length.toLocaleString("zh-CN") + " 字符";
	}
	function schedulePreview() {
		clearTimeout(state.previewTimer);
		state.previewGeneration += 1;
		state.previewAbort?.abort();
		if (
			!state.current?.document ||
			state.mode !== "structured" ||
			!state.previewVisible
		)
			return;
		const generation = state.previewGeneration;
		$("preview-status").textContent = "更新中…";
		state.previewTimer = setTimeout(async () => {
			const abort = new AbortController();
			state.previewAbort = abort;
			try {
				const data = await api("/api/preview", {
					method: "POST",
					body: JSON.stringify({ markdown: $("body-editor").value }),
					signal: abort.signal,
				});
				if (generation !== state.previewGeneration) return;
				// Untrusted content stays inside a scriptless, opaque-origin frame.
				const frameDocument =
					document.implementation.createHTMLDocument("阅读预览");
				frameDocument.documentElement.lang = "zh-CN";
				const stylesheet = frameDocument.createElement("link");
				stylesheet.rel = "stylesheet";
				stylesheet.href = location.origin + "/style.css";
				frameDocument.head.append(stylesheet);
				frameDocument.body.className = "preview-document";
				const container = frameDocument.createElement("article");
				container.className = "preview-content";
				// This is the only HTML rendering boundary: HTML is sanitized by /api/preview,
				// and sandbox="" independently prevents scripts, forms and parent access.
				const parsed = new DOMParser().parseFromString(
					typeof data.html === "string" ? data.html : "",
					"text/html",
				);
				for (const image of parsed.querySelectorAll("img[src]")) {
					const source = image.getAttribute("src");
					let relativePath = "";
					if (source && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
						relativePath = new URL(
							source,
							"http://manager/" + state.current.path,
						).pathname.slice(1);
					}
					const media = state.media.find(
						(file) =>
							file.reference === source ||
							file.path === "public" + source ||
							file.path === relativePath,
					);
					if (media)
						image.src =
							location.origin +
							"/api/media?path=" +
							encodeURIComponent(media.path) +
							"&token=" +
							encodeURIComponent(token);
				}
				container.append(...Array.from(parsed.body.childNodes));
				frameDocument.body.append(container);
				$("markdown-preview").srcdoc =
					"<!doctype html>" + frameDocument.documentElement.outerHTML;
				$("preview-status").textContent = "已更新";
			} catch (error) {
				if (error.name !== "AbortError") {
					$("preview-status").textContent = "预览失败";
					handleError(error);
				}
			}
		}, 350);
	}

	function renderSettingsShortcuts() {
		const shortcuts = [
			[
				"站点与横幅",
				"站名、各栏目图片、主题色与循环打字",
				"siteConfig.ts",
				"站",
			],
			["个人资料", "头像、昵称、个人简介与社交链接", "profileConfig.ts", "我"],
			["导航菜单", "顶部菜单、分组和跳转地址", "navBarConfig.ts", "导"],
			["侧栏布局", "左右侧栏、卡片顺序和展示范围", "sidebarConfig.ts", "栏"],
			["文章展示", "文章列表、阅读信息与分享选项", "postListConfig.ts", "文"],
			["页脚与公告", "站点底部信息和公告内容", "footerConfig.ts", "告"],
		];
		$("settings-shortcuts").replaceChildren();
		for (const [title, description, name, symbol] of shortcuts) {
			const file = state.files.find(
				(item) => item.path === "src/config/" + name,
			);
			if (!file) continue;
			const button = element("button", "settings-card");
			button.type = "button";
			const icon = element("span", "settings-card-symbol", symbol);
			const copy = element("span", "settings-card-copy");
			copy.append(
				element("strong", "", title),
				element("span", "", description),
			);
			button.append(icon, copy, element("span", "card-arrow", "↗"));
			button.addEventListener("click", () => {
				void openFile(file.path);
			});
			$("settings-shortcuts").append(button);
		}
	}

	function renderMedia() {
		$("media-grid").replaceChildren();
		if (!state.media.length)
			$("media-grid").append(
				element("p", "list-empty", "还没有可用的图片素材。"),
			);
		for (const file of state.media) {
			const card = element("article", "media-card");
			const image = element("img", "media-thumbnail");
			image.src =
				"/api/media?path=" +
				encodeURIComponent(file.path) +
				"&token=" +
				encodeURIComponent(token);
			image.alt = fileName(file.path);
			image.loading = "lazy";
			image.referrerPolicy = "no-referrer";
			const info = element("div", "media-info");
			info.append(
				element("strong", "", fileName(file.path)),
				element("code", "", file.reference || file.path),
				element("span", "media-size", formatSize(file.size)),
			);
			const copy = element("button", "button button-small", "复制引用");
			copy.type = "button";
			copy.addEventListener("click", async () => {
				try {
					await navigator.clipboard.writeText(file.reference || file.path);
					toast("图片引用已复制。");
				} catch {
					showError("无法访问剪贴板，请选中图片引用后手动复制。");
				}
			});
			info.append(copy);
			card.append(image, info);
			$("media-grid").append(card);
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
	async function uploadImages(files) {
		if (!files.length) return;
		clearError();
		$("media-upload").disabled = true;
		try {
			let index = 0;
			for (const file of files) {
				if (!file.type.startsWith("image/"))
					throw new Error("只支持上传图片：" + file.name);
				if (file.size > 10 * 1024 * 1024)
					throw new Error("图片超过 10 MiB，请压缩后再上传：" + file.name);
				$("upload-status").textContent =
					"正在上传 " + ++index + " / " + files.length + " · " + file.name;
				await api("/api/upload", {
					method: "POST",
					body: JSON.stringify({
						name: file.name,
						data: await readBase64(file),
					}),
				});
			}
			$("upload-status").textContent = "已添加 " + files.length + " 张图片。";
			await refreshState(true);
		} catch (error) {
			handleError(error);
			$("upload-status").textContent = "上传未完成，已成功的图片仍保留。";
		} finally {
			$("media-upload").disabled = false;
			$("media-upload").value = "";
		}
	}

	function pendingPush() {
		const pending = state.git.pendingPush;
		return pending && typeof pending === "object" ? pending : null;
	}
	function renderPublish() {
		const git = state.git;
		const changes = Array.isArray(git.changed) ? git.changed : [];
		const pending = pendingPush();
		const retry = pending?.canRetry === true;
		const unknownAhead = !pending && Number(git.ahead) > 0;
		$("push-recovery").hidden = !pending && !unknownAhead;
		$("push-recovery-title").textContent = pending
			? retry
				? "上次发布等待完成，可直接重试推送"
				: "待推送的发布需要核对"
			: "发现本地提交，发布前会重新核对远端";
		const commit =
			typeof pending?.commit === "string" ? pending.commit.slice(0, 8) : "";
		$("push-recovery-text").textContent = pending
			? retry
				? `管理台已保存上次提交${commit ? ` ${commit}` : ""}。点击“重试推送”继续，不会重复构建或创建提交；之后的内容修改留待下一次发布。`
				: pending.reason ||
					"当前版本与管理台记录不一致，已停止自动推送。请先核对这些提交。"
			: "有本地提交待核对，发布时会重新查询远端；仅管理台已记录的失败发布能安全重试，其他提交不自动推送。";
		$("git-details").replaceChildren();
		for (const [name, value] of [
			["当前分支", git.branch || "尚未获取"],
			["待推送提交（本地记录）", String(git.ahead ?? 0)],
			["落后远端提交（本地记录）", String(git.behind ?? 0)],
		]) {
			$("git-details").append(
				element("dt", "", name),
				element("dd", "", value),
			);
		}
		$("change-count").textContent = String(changes.length);
		$("change-list").replaceChildren();
		for (const change of changes) {
			const row = element("div", "change-item");
			row.append(
				element("code", "change-status", change.status || "M"),
				element("span", "", change.path || String(change)),
			);
			$("change-list").append(row);
		}
		if (!changes.length)
			$("change-list").append(
				element("p", "list-empty", "工作区很整洁，暂时没有未提交的文件。"),
			);
		$("validate-button").disabled = Boolean(state.job);
		$("publish-button").disabled =
			Boolean(state.job) || Boolean(pending && !retry);
		$("publish-button").textContent = retry ? "重试推送 ↗" : "提交并发布 ↗";
		$("commit-message-field").hidden = Boolean(pending);
		$("commit-message").disabled = Boolean(state.job) || Boolean(pending);
	}

	async function runJob(kind) {
		if (state.job) return;
		const pending = pendingPush();
		const retry = kind === "publish" && pending?.canRetry === true;
		if (kind === "publish" && pending && !retry) {
			showError(pending.reason || "请先核对待推送的发布，再继续操作。");
			return;
		}
		if (state.dirty && !retry) {
			if (
				!window.confirm(
					"当前还有未保存的修改。先保存再" +
						(kind === "publish" ? "发布" : "检查") +
						"吗？",
				)
			)
				return;
			if (!(await saveCurrent())) return;
		}
		const message = retry ? "" : $("commit-message").value.trim();
		if (kind === "publish") {
			if (!retry && !message) {
				showError("请填写本次更新说明。");
				$("commit-message").focus();
				return;
			}
			if (
				!window.confirm(
					retry
						? "将重试推送管理台已保存的上次提交，不会重复构建或创建提交，之后的编辑会留待下一次发布。确定继续吗？"
						: "将运行检查、提交并推送本管理台保存的文件，触发 GitHub Pages 更新。其他本地改动不会提交。确定发布吗？",
				)
			)
				return;
		}
		clearError();
		try {
			const result = await api(
				kind === "publish" ? "/api/publish" : "/api/validate",
				{
					method: "POST",
					body: JSON.stringify(kind === "publish" && !retry ? { message } : {}),
				},
			);
			const job = result.job || result;
			if (!job.id) throw new Error("服务未返回任务编号，请查看本地终端。");
			state.job = job.id;
			$("job-panel").hidden = false;
			$("job-title").textContent = retry
				? "重试推送日志"
				: kind === "publish"
					? "发布日志"
					: "检查日志";
			$("job-log").textContent = "";
			$("job-message").textContent = "";
			$("job-state").textContent = "执行中";
			$("job-state").className = "job-state is-running";
			renderPublish();
			updateDirty(state.dirty);
			void pollJob(job.id);
		} catch (error) {
			handleError(error);
		}
	}
	async function pollJob(id) {
		try {
			const result = await api("/api/job?id=" + encodeURIComponent(id));
			const job = result.job || result;
			const log = Array.isArray(job.log)
				? job.log.join("\n")
				: String(job.log || "");
			const nearEnd =
				$("job-log").scrollHeight -
					$("job-log").scrollTop -
					$("job-log").clientHeight <
				90;
			$("job-log").textContent = log;
			if (nearEnd) $("job-log").scrollTop = $("job-log").scrollHeight;
			if (job.status === "running") {
				setTimeout(() => {
					void pollJob(id);
				}, 1200);
				return;
			}
			state.job = null;
			const success = job.status === "success";
			$("job-state").textContent = success ? "已完成" : "未完成";
			$("job-state").className =
				"job-state " + (success ? "is-success" : "is-failed");
			$("job-message").textContent =
				job.message ||
				(success
					? "任务已成功完成。"
					: "任务失败，请查看上方日志；文件仍保存在本地。");
			if (!success) showError(job.message || "任务未完成，请查看运行日志。");
			await refreshState(true);
			renderPublish();
			updateDirty(state.dirty);
		} catch (error) {
			state.job = null;
			$("job-state").textContent = "连接中断";
			$("job-state").className = "job-state is-failed";
			$("job-message").textContent =
				"日志连接中断，后台任务可能仍在运行。请查看本地终端，再刷新状态。";
			handleError(error);
			renderPublish();
			updateDirty(state.dirty);
		}
	}

	async function loadHistory() {
		$("history-list").replaceChildren(
			element("p", "list-empty", "正在加载备份…"),
		);
		try {
			const data = await api("/api/history");
			$("history-list").replaceChildren();
			const backups = Array.isArray(data.backups) ? data.backups : [];
			for (const backup of backups) {
				const row = element("article", "history-item");
				const copy = element("div", "history-copy");
				copy.append(
					element("strong", "", backup.path),
					element(
						"p",
						"",
						[formatDate(backup.createdAt), backup.reason || "保存前备份"]
							.filter(Boolean)
							.join(" · "),
					),
				);
				const button = element("button", "button button-small", "恢复此版本");
				button.type = "button";
				button.addEventListener("click", async () => {
					if (
						!mayDiscard() ||
						!window.confirm(
							"将恢复 " +
								backup.path +
								" 的此版本，并覆盖当前本地文件。继续吗？",
						)
					)
						return;
					button.disabled = true;
					try {
						await api("/api/restore", {
							method: "POST",
							body: JSON.stringify({ id: backup.id }),
						});
						state.current = null;
						updateDirty(false);
						await refreshState(true);
						toast("已恢复本地文件。");
						await loadHistory();
					} catch (error) {
						handleError(error);
						button.disabled = false;
					}
				});
				row.append(copy, button);
				$("history-list").append(row);
			}
			if (!backups.length)
				$("history-list").append(
					element(
						"p",
						"list-empty",
						"暂时还没有备份。第一次保存后会出现在这里。",
					),
				);
		} catch (error) {
			handleError(error);
			$("history-list").replaceChildren(
				element("p", "list-empty", "备份加载失败，请点击刷新列表重试。"),
			);
		}
	}

	function openNewDialog() {
		if (!mayDiscard()) return;
		$("new-error").hidden = true;
		$("new-collection").value =
			state.group === "pages"
				? "spec"
				: $("collection-filter").value || "posts";
		$("new-dialog").showModal();
		$("new-title").focus();
	}
	async function createDocument(event) {
		event.preventDefault();
		$("new-submit").disabled = true;
		$("new-error").hidden = true;
		try {
			const data = await api("/api/new", {
				method: "POST",
				body: JSON.stringify({
					collection: $("new-collection").value,
					slug: $("new-slug").value.trim(),
					title: $("new-title").value.trim(),
				}),
			});
			const file = data.file || data;
			if (!file.path) throw new Error("服务未返回新文件路径。");
			$("new-dialog").close();
			state.current = null;
			updateDirty(false);
			const group = classify(file);
			if (group !== state.group) await selectGroup(group);
			await refreshState(true);
			await openFile(file.path, { force: true });
			$("new-form").reset();
			toast("内容已创建在本地。");
		} catch (error) {
			$("new-error").textContent = error.message;
			$("new-error").hidden = false;
		} finally {
			$("new-submit").disabled = false;
		}
	}
	async function deleteCurrent() {
		if (!state.current || state.saving || state.job) return;
		const current = state.current;
		if (
			!window.confirm(
				"确定删除本地文件 " +
					current.path +
					"？删除前会保留备份；发布后线上内容也会移除。",
			)
		)
			return;
		try {
			await api("/api/file", {
				method: "DELETE",
				body: JSON.stringify({ path: current.path, hash: current.hash }),
			});
			state.current = null;
			updateDirty(false);
			$("editor-content").hidden = true;
			$("editor-empty").hidden = false;
			await refreshState(true);
			toast("文件已从本地删除，可在备份中恢复。");
		} catch (error) {
			handleError(error);
		}
	}

	function setTheme(theme) {
		document.documentElement.dataset.theme = theme;
		localStorage.setItem("blog-manager-theme", theme);
		$("theme-button").setAttribute(
			"aria-label",
			theme === "dark" ? "切换浅色主题" : "切换深色主题",
		);
		$("theme-button").setAttribute("aria-pressed", String(theme === "dark"));
	}
	try {
		setTheme(
			localStorage.getItem("blog-manager-theme") ||
				(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
		);
	} catch {
		document.documentElement.dataset.theme = "light";
	}
	$("theme-button").addEventListener("click", () => {
		setTheme(
			document.documentElement.dataset.theme === "dark" ? "light" : "dark",
		);
	});
	$("menu-button").addEventListener("click", () =>
		setSidebar(!document.body.classList.contains("sidebar-open")),
	);
	$("sidebar-backdrop").addEventListener("click", () => setSidebar(false));
	document.querySelectorAll("[data-group]").forEach((button) => {
		button.addEventListener("click", () => {
			void selectGroup(button.dataset.group);
		});
	});
	$("history-button").addEventListener("click", () => {
		void selectGroup("history");
	});
	$("dismiss-error").addEventListener("click", clearError);
	$("file-search").addEventListener("input", renderFiles);
	$("collection-filter").addEventListener("change", renderFiles);
	$("save-button").addEventListener("click", () => {
		void saveCurrent();
	});
	$("open-publish-button").addEventListener("click", () => {
		void selectGroup("publish");
	});
	$("form-mode").addEventListener("click", () => {
		void switchMode("structured");
	});
	$("source-mode").addEventListener("click", () => {
		void switchMode("source");
	});
	$("metadata-form").addEventListener("submit", (event) =>
		event.preventDefault(),
	);
	$("settings-fields").addEventListener("submit", (event) =>
		event.preventDefault(),
	);
	$("metadata-form").addEventListener("input", () => updateDirty());
	$("body-editor").addEventListener("input", () => {
		updateDirty();
		countCharacters();
		schedulePreview();
	});
	$("body-editor").addEventListener("keydown", (event) => {
		if (event.key !== "Tab" || event.shiftKey) return;
		event.preventDefault();
		const input = event.currentTarget;
		input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	$("preview-toggle").addEventListener("click", () => {
		state.previewVisible = !state.previewVisible;
		$("preview-column").hidden = !state.previewVisible;
		$("edit-layout").classList.toggle("has-preview", state.previewVisible);
		$("preview-toggle").setAttribute(
			"aria-pressed",
			String(state.previewVisible),
		);
		$("preview-toggle").textContent = state.previewVisible
			? "隐藏预览"
			: "显示预览";
		schedulePreview();
	});
	$("show-settings-files").addEventListener("click", () => {
		$("settings-panel").hidden = true;
		$("editor-workspace").hidden = false;
		state.settingsList = true;
		renderFiles();
	});
	$("refresh-button").addEventListener("click", async () => {
		if (state.group === "history") await loadHistory();
		else {
			await refreshState();
			if (
				state.current &&
				!state.dirty &&
				window.confirm("文件列表已刷新。是否重新载入当前文件的最新内容？")
			) {
				await openFile(state.current.path, { force: true, mode: state.mode });
			}
		}
	});
	for (const id of ["new-button", "empty-new-button"])
		$(id).addEventListener("click", openNewDialog);
	for (const id of ["new-close", "new-cancel"])
		$(id).addEventListener("click", () => $("new-dialog").close());
	$("new-form").addEventListener("submit", (event) => {
		void createDocument(event);
	});
	$("delete-button").addEventListener("click", () => {
		void deleteCurrent();
	});
	$("media-upload").addEventListener("change", (event) => {
		void uploadImages(Array.from(event.target.files));
	});
	$("upload-zone").addEventListener("dragover", (event) => {
		event.preventDefault();
		$("upload-zone").classList.add("is-dragging");
	});
	$("upload-zone").addEventListener("dragleave", () =>
		$("upload-zone").classList.remove("is-dragging"),
	);
	$("upload-zone").addEventListener("drop", (event) => {
		event.preventDefault();
		$("upload-zone").classList.remove("is-dragging");
		if (!$("media-upload").disabled)
			void uploadImages(Array.from(event.dataTransfer.files));
	});
	$("validate-button").addEventListener("click", () => {
		void runJob("validate");
	});
	$("publish-button").addEventListener("click", () => {
		void runJob("publish");
	});
	document.addEventListener("keydown", (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			void saveCurrent();
		}
		if (event.key === "Escape") setSidebar(false);
	});
	window.addEventListener("beforeunload", (event) => {
		if (!state.dirty) return;
		event.preventDefault();
		event.returnValue = "";
	});
	void refreshState();
})();
