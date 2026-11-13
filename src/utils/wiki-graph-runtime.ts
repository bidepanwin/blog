/**
 * wiki-graph-runtime：canvas 力导向双链关系图。
 * 斥力 + 弹簧 + 向心力 + 阻尼，支持拖拽、hover 提示、点击跳转。
 * prefers-reduced-motion：跳过动画，只做一次性布局。
 */
interface GraphNode {
	id: string;
	title: string;
	url: string;
	kind: "thinking" | "post";
	school: string;
}
interface GraphData {
	nodes: GraphNode[];
	edges: Array<[string, string]>;
	broken: number;
}

interface SimNode extends GraphNode {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
}

const KIND_COLOR: Record<string, string> = {
	thinking: "#8b9bff",
	post: "#4fd1c5",
};

export function initWikiGraph(
	canvas: HTMLCanvasElement,
	data: GraphData,
): void {
	if (!canvas || !data?.nodes?.length) return;
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const tip = document.getElementById("graph-tip") as HTMLElement | null;

	let W = 0;
	let H = 0;
	let dpr = 1;
	const sim: SimNode[] = [];
	const index = new Map<string, SimNode>();
	let hovered: SimNode | null = null;
	let dragging: SimNode | null = null;
	let dragMoved = false;

	// 边引用
	const edges = data.edges
		.map(([a, b]) => [index.get(a), index.get(b)] as const)
		.filter(([a, b]) => a && b);

	function layoutInit() {
		const n = data.nodes.length;
		const idx = new Map(data.nodes.map((d, i) => [d.id, i]));
		sim.length = 0;
		index.clear();
		const R = Math.min(W, H) * 0.36;
		data.nodes.forEach((d, i) => {
			const angle = (i / n) * Math.PI * 2 + (i % 7) * 0.13;
			const rr = R * (0.55 + ((i * 37) % 100) / 220);
			const node: SimNode = {
				...d,
				x: W / 2 + Math.cos(angle) * rr,
				y: H / 2 + Math.sin(angle) * rr,
				vx: 0,
				vy: 0,
				r:
					3.5 +
					Math.min(
						6,
						data.edges.filter((e) => e[0] === d.id || e[1] === d.id).length *
							1.1,
					),
			};
			sim.push(node);
			index.set(d.id, node);
		});
		edges.length = 0;
		for (const [a, b] of data.edges) {
			const na = index.get(a),
				nb = index.get(b);
			if (na && nb) edges.push([na, nb] as const);
		}
	}

	function resize() {
		const rect = canvas.getBoundingClientRect();
		dpr = Math.min(window.devicePixelRatio || 1, 1.5);
		W = Math.max(320, Math.floor(rect.width));
		H = Math.max(240, Math.floor(rect.height));
		canvas.width = W * dpr;
		canvas.height = H * dpr;
		ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
		layoutInit();
	}

	let raf = 0;
	function step() {
		const cx = W / 2,
			cy = H / 2;
		// 斥力
		for (let i = 0; i < sim.length; i++) {
			const a = sim[i];
			for (let j = i + 1; j < sim.length; j++) {
				const b = sim[j];
				let dx = b.x - a.x,
					dy = b.y - a.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1) {
					dx = Math.random() - 0.5;
					dy = Math.random() - 0.5;
					d2 = 1;
				}
				const d = Math.sqrt(d2);
				const f = 900 / d2;
				const fx = (dx / d) * f,
					fy = (dy / d) * f;
				a.vx -= fx;
				a.vy -= fy;
				b.vx += fx;
				b.vy += fy;
			}
		}
		// 弹簧
		for (const [a, b] of edges) {
			if (!a || !b) continue;
			const dx = b.x - a.x,
				dy = b.y - a.y;
			const d = Math.hypot(dx, dy) || 1;
			const f = (d - 92) * 0.012;
			const fx = (dx / d) * f,
				fy = (dy / d) * f;
			a.vx += fx;
			a.vy += fy;
			b.vx -= fx;
			b.vy -= fy;
		}
		// 向心 + 阻尼
		for (const n of sim) {
			n.vx += (cx - n.x) * 0.0025;
			n.vy += (cy - n.y) * 0.0025;
			if (n === dragging) {
				n.vx = 0;
				n.vy = 0;
				continue;
			}
			n.vx *= 0.86;
			n.vy *= 0.86;
			n.x += n.vx;
			n.y += n.vy;
			const m = n.r + 6;
			n.x = Math.max(m, Math.min(W - m, n.x));
			n.y = Math.max(m, Math.min(H - m, n.y));
		}
	}

	function draw() {
		ctx!.clearRect(0, 0, W, H);
		// 边
		ctx!.strokeStyle = "rgba(139, 155, 255, 0.16)";
		ctx!.lineWidth = 1;
		for (const [a, b] of edges) {
			if (!a || !b) continue;
			ctx!.beginPath();
			ctx!.moveTo(a.x, a.y);
			ctx!.lineTo(b.x, b.y);
			ctx!.stroke();
		}
		// 节点
		for (const n of sim) {
			const c = KIND_COLOR[n.kind] ?? "#8b9bff";
			ctx!.beginPath();
			ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
			ctx!.fillStyle = n === hovered ? "#ffffff" : c;
			ctx!.fill();
			if (n === hovered) {
				ctx!.strokeStyle = c;
				ctx!.lineWidth = 1.5;
				ctx!.stroke();
			}
		}
	}

	function loop() {
		step();
		draw();
		raf = requestAnimationFrame(loop);
	}

	function hit(x: number, y: number): SimNode | null {
		let best: SimNode | null = null;
		let bestD = 18;
		for (const n of sim) {
			const d = Math.hypot(n.x - x, n.y - y);
			if (d < Math.max(bestD, n.r + 6)) {
				bestD = d;
				best = n;
			}
		}
		return best;
	}

	function pos(e: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	canvas.addEventListener("pointermove", (e) => {
		const { x, y } = pos(e);
		if (dragging) {
			dragging.x = x;
			dragging.y = y;
			dragMoved = true;
			draw();
			return;
		}
		const h = hit(x, y);
		if (h !== hovered) {
			hovered = h;
			if (tip) {
				if (h) {
					tip.hidden = false;
					tip.textContent = h.title;
					tip.style.left = `${h.x}px`;
					tip.style.top = `${h.y}px`;
				} else tip.hidden = true;
			}
			draw();
		}
	});
	canvas.addEventListener("pointerdown", (e) => {
		const { x, y } = pos(e);
		dragging = hit(x, y);
		dragMoved = false;
		if (dragging) canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener("pointerup", (e) => {
		const { x, y } = pos(e);
		const target = dragging ?? hit(x, y);
		const moved = dragMoved;
		dragging = null;
		dragMoved = false;
		if (target && !moved) window.location.href = target.url;
	});
	canvas.addEventListener("pointerleave", () => {
		hovered = null;
		if (tip) tip.hidden = true;
		draw();
	});

	resize();
	window.addEventListener("resize", () => {
		resize();
		if (reduced) {
			for (let i = 0; i < 120; i++) step();
			draw();
		}
	});

	if (reduced) {
		for (let i = 0; i < 160; i++) step();
		draw();
	} else {
		loop();
	}
	document.addEventListener("swup:page:view", () => {
		// 离开页面时停止（元素已移除）
		if (!document.body.contains(canvas)) cancelAnimationFrame(raf);
	});
}
