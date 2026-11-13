/**
 * Mac 代码块工具栏交互：给每个 figure.frame 注入三圆点按钮 + 语言标签。
 * 红=折叠/展开，黄=装饰，绿=打开页面内全屏 modal（非浏览器铺满）。
 * Swup 切页后经 swup:content:replace 重初始化；幂等。
 */

let modalEl: HTMLElement | null = null;
let modalContent: HTMLElement | null = null;
let modalTitle: HTMLElement | null = null;
let modalWrapBtn: HTMLButtonElement | null = null;
let modalCopyBtn: HTMLButtonElement | null = null;

function getModal() {
	if (modalEl) return modalEl;

	const overlay = document.createElement("div");
	overlay.className = "code-modal-overlay";
	overlay.setAttribute("hidden", "");

	const dialog = document.createElement("div");
	dialog.className = "code-modal";
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-modal", "true");
	dialog.setAttribute("aria-label", "全屏查看代码");

	// 头部：三键 + 语言标签 + 右侧操作按钮（横排）
	const header = document.createElement("div");
	header.className = "code-modal-header";

	const dots = document.createElement("div");
	dots.className = "mac-dots";
	const dotClose = document.createElement("span");
	dotClose.className = "mac-dot mac-dot--close";
	dotClose.dataset.glyph = "✕";
	dotClose.setAttribute("role", "button");
	dotClose.setAttribute("tabindex", "0");
	dotClose.setAttribute("aria-label", "关闭");
	dotClose.title = "关闭";
	const dotMin = document.createElement("span");
	dotMin.className = "mac-dot mac-dot--min";
	dotMin.dataset.glyph = "−";
	dotMin.setAttribute("aria-hidden", "true");
	const dotMax = document.createElement("span");
	dotMax.className = "mac-dot mac-dot--max";
	dotMax.setAttribute("aria-hidden", "true");
	dots.append(dotClose, dotMin, dotMax);

	modalTitle = document.createElement("span");
	modalTitle.className = "mac-title";

	const actions = document.createElement("div");
	actions.className = "code-modal-actions";

	modalWrapBtn = document.createElement("button");
	modalWrapBtn.type = "button";
	modalWrapBtn.className = "code-modal-btn";
	modalWrapBtn.textContent = "Wrap";
	modalWrapBtn.setAttribute("aria-pressed", "false");
	modalWrapBtn.title = "自动换行";

	modalCopyBtn = document.createElement("button");
	modalCopyBtn.type = "button";
	modalCopyBtn.className = "code-modal-btn";
	modalCopyBtn.textContent = "复制";

	actions.append(modalWrapBtn, modalCopyBtn);
	header.append(dots, modalTitle, actions);

	modalContent = document.createElement("pre");
	modalContent.className = "code-modal-content";
	modalContent.setAttribute("tabindex", "0");

	dialog.append(header, modalContent);
	overlay.append(dialog);
	document.body.append(overlay);

	const close = () => {
		overlay.setAttribute("hidden", "");
		document.body.style.overflow = "";
	};
	dotClose.addEventListener("click", close);
	dotClose.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			close();
		}
	});
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) close();
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !overlay.hasAttribute("hidden")) close();
	});
	modalWrapBtn.addEventListener("click", () => {
		const on = modalWrapBtn!.getAttribute("aria-pressed") === "true";
		modalWrapBtn!.setAttribute("aria-pressed", String(!on));
		if (modalContent) {
			modalContent.style.whiteSpace = on ? "pre" : "pre-wrap";
			modalContent.style.overflowWrap = on ? "normal" : "anywhere";
		}
	});
	modalCopyBtn.addEventListener("click", async () => {
		const text = modalContent?.innerText ?? "";
		try {
			await navigator.clipboard.writeText(text);
			modalCopyBtn!.textContent = "已复制";
			setTimeout(() => {
				if (modalCopyBtn) modalCopyBtn.textContent = "复制";
			}, 1500);
		} catch {
			/* 剪贴板不可用时静默 */
		}
	});

	modalEl = overlay;
	return overlay;
}

export function initMacCodeblocks(): void {
	const frames = document.querySelectorAll<HTMLElement>(
		"figure.frame:not([data-mac-init])",
	);
	frames.forEach((frame) => {
		const header = frame.querySelector("figcaption.header");
		const pre = frame.querySelector("pre");
		if (!header || !pre) return;
		frame.setAttribute("data-mac-init", "1");

		const dots = document.createElement("div");
		dots.className = "mac-dots";

		const btnClose = document.createElement("span");
		btnClose.className = "mac-dot mac-dot--close";
		btnClose.dataset.glyph = "✕";
		btnClose.setAttribute("role", "button");
		btnClose.setAttribute("tabindex", "0");
		btnClose.setAttribute("aria-label", "折叠代码块");
		btnClose.title = "折叠 / 展开";

		const btnMin = document.createElement("span");
		btnMin.className = "mac-dot mac-dot--min";
		btnMin.dataset.glyph = "−";
		btnMin.setAttribute("aria-hidden", "true");

		const btnMax = document.createElement("span");
		btnMax.className = "mac-dot mac-dot--max";
		btnMax.dataset.glyph = "⤢";
		btnMax.setAttribute("role", "button");
		btnMax.setAttribute("tabindex", "0");
		btnMax.setAttribute("aria-label", "全屏查看代码");
		btnMax.title = "全屏";

		dots.append(btnClose, btnMin, btnMax);
		header.prepend(dots);

		const isTerminal = frame.classList.contains("is-terminal");
		const lang = pre.getAttribute("data-language");
		const label = document.createElement("span");
		label.className = "mac-title";
		label.textContent = isTerminal ? "bash" : lang || "code";
		label.title = label.textContent;
		dots.after(label);

		// 把 ec 自带的复制按钮移进工具栏右侧（去掉右上角浮层）
		const copyBtn = frame.querySelector<HTMLElement>(":scope > .copy-btn");
		if (copyBtn) header.append(copyBtn);

		const toggleCollapse = () => {
			frame.classList.toggle("is-collapsed");
			btnClose.setAttribute(
				"aria-label",
				frame.classList.contains("is-collapsed") ? "展开代码块" : "折叠代码块",
			);
		};
		btnClose.addEventListener("click", toggleCollapse);
		btnClose.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggleCollapse();
			}
		});
		header.addEventListener("dblclick", (e) => {
			if ((e.target as HTMLElement).closest(".mac-dot")) return;
			toggleCollapse();
		});

		// 绿键：打开页面内全屏 modal（不铺满屏幕）
		const openModal = () => {
			const overlay = getModal();
			const title = isTerminal ? "bash" : lang || "code";
			if (modalTitle) modalTitle.textContent = title;
			if (modalContent) {
				modalContent.replaceChildren(
					...Array.from(pre.children).map((n) => n.cloneNode(true)),
				);
				modalContent.style.whiteSpace = "pre";
				modalContent.style.overflowWrap = "normal";
				modalContent.scrollTop = 0;
				modalContent.scrollLeft = 0;
			}
			if (modalWrapBtn) modalWrapBtn.setAttribute("aria-pressed", "false");
			overlay.removeAttribute("hidden");
			document.body.style.overflow = "hidden";
			modalContent?.focus();
		};
		btnMax.addEventListener("click", openModal);
		btnMax.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				openModal();
			}
		});
	});
}

/** 幂等绑定：直接执行 + Swup 换页后重跑 */
export function bindMacCodeblocks(): void {
	initMacCodeblocks();
	if (!document.documentElement.dataset.macCodeblocksBound) {
		document.documentElement.dataset.macCodeblocksBound = "true";
		document.addEventListener("swup:content:replace", () =>
			initMacCodeblocks(),
		);
		document.addEventListener("swup:page:view", () => initMacCodeblocks());
	}
}
