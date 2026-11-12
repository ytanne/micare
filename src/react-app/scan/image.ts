// Pure image processing for the scanner: edge detection, perspective warp, filters.
export interface Pt { x: number; y: number }
export type Filter = "color" | "gray" | "bw";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const luma = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

export const defaultCorners = (): Pt[] => [
	{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
];

/** Guess the page corners (TL, TR, BR, BL; normalized 0..1) assuming a bright page on a darker background. */
export function detectCorners(img: ImageData): Pt[] {
	const n = 160;
	const sc = n / Math.max(img.width, img.height);
	const w = Math.max(8, Math.round(img.width * sc)), h = Math.max(8, Math.round(img.height * sc));
	const g = new Float32Array(w * h);
	const hist = new Array(256).fill(0);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const sx = Math.min(img.width - 1, Math.floor(x / sc)), sy = Math.min(img.height - 1, Math.floor(y / sc));
			const v = luma(img.data, (sy * img.width + sx) * 4);
			g[y * w + x] = v;
			hist[v | 0]++;
		}
	}
	// Otsu threshold.
	const total = w * h;
	let sumAll = 0;
	for (let i = 0; i < 256; i++) sumAll += i * hist[i];
	let wB = 0, sumB = 0, best = 0, t = 128;
	for (let i = 0; i < 256; i++) {
		wB += hist[i];
		if (!wB || wB === total) continue;
		sumB += i * hist[i];
		const mB = sumB / wB, mF = (sumAll - sumB) / (total - wB);
		const between = wB * (total - wB) * (mB - mF) ** 2;
		if (between > best) { best = between; t = i; }
	}
	const mask = new Uint8Array(w * h);
	for (let i = 0; i < mask.length; i++) mask[i] = g[i] > t ? 1 : 0;
	// 3x3 erosion drops speckle so stray pixels don't become corners.
	const er = new Uint8Array(w * h);
	let count = 0;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			let all = 1;
			for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) all &= mask[(y + dy) * w + x + dx];
			er[y * w + x] = all;
			count += all;
		}
	}
	if (count < total * 0.1 || count > total * 0.95) return defaultCorners();
	const c = [Infinity, -Infinity, -Infinity, Infinity]; // TL min x+y, TR max x-y, BR max x+y, BL min x-y
	const p: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!er[y * w + x]) continue;
			const s = x + y, d = x - y;
			if (s < c[0]) { c[0] = s; p[0] = { x, y }; }
			if (d > c[1]) { c[1] = d; p[1] = { x, y }; }
			if (s > c[2]) { c[2] = s; p[2] = { x, y }; }
			if (d < c[3]) { c[3] = d; p[3] = { x, y }; }
		}
	}
	return p.map((q) => ({ x: Math.min(1, Math.max(0, q.x / w)), y: Math.min(1, Math.max(0, q.y / h)) }));
}

// Solve for the homography mapping output (u,v) -> source (x,y), given 4 point pairs.
function homography(dst: Pt[], src: Pt[]): number[] {
	const m: number[][] = [];
	for (let i = 0; i < 4; i++) {
		const { x: u, y: v } = dst[i], { x, y } = src[i];
		m.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
		m.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
	}
	for (let c = 0; c < 8; c++) {
		let p = c;
		for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
		[m[c], m[p]] = [m[p], m[c]];
		if (Math.abs(m[c][c]) < 1e-12) continue;
		for (let r = 0; r < 8; r++) {
			if (r === c) continue;
			const f = m[r][c] / m[c][c];
			for (let k = c; k < 9; k++) m[r][k] -= f * m[c][k];
		}
	}
	return m.map((row, i) => row[8] / row[i]);
}

/** Crop + straighten the quad `corners` (normalized) into a rectangle, then apply a filter. */
export function scan(src: ImageData, corners: Pt[], filter: Filter, maxSide: number): ImageData {
	const q = corners.map((c) => ({ x: c.x * src.width, y: c.y * src.height }));
	let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
	const k = Math.min(1, maxSide / Math.max(w, h, 1));
	w = Math.max(1, Math.round(w * k));
	h = Math.max(1, Math.round(h * k));
	const H = homography([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], q);
	const out = new ImageData(w, h);
	const sd = src.data, od = out.data, sw = src.width, sh = src.height;
	for (let v = 0; v < h; v++) {
		for (let u = 0; u < w; u++) {
			const z = H[6] * u + H[7] * v + 1;
			const x = Math.min(sw - 1.001, Math.max(0, (H[0] * u + H[1] * v + H[2]) / z));
			const y = Math.min(sh - 1.001, Math.max(0, (H[3] * u + H[4] * v + H[5]) / z));
			const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
			const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
			const o = (v * w + u) * 4;
			for (let c = 0; c < 3; c++) {
				od[o + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
			}
			od[o + 3] = 255;
		}
	}
	if (filter !== "color") grayscale(out, filter === "bw");
	return out;
}

function grayscale(img: ImageData, threshold: boolean) {
	const { width: w, height: h, data: d } = img;
	const g = new Float32Array(w * h);
	const hist = new Array(256).fill(0);
	for (let i = 0; i < g.length; i++) { g[i] = luma(d, i * 4); hist[g[i] | 0]++; }
	let lo = 0, hi = 255, acc = 0;
	while (lo < 254 && (acc += hist[lo]) < g.length * 0.02) lo++;
	for (acc = 0; hi > lo + 1 && (acc += hist[hi]) < g.length * 0.02; hi--);
	const span = Math.max(1, hi - lo);
	if (threshold) {
		// Adaptive threshold against the local mean (integral image) so shadows don't turn black.
		const ii = new Float64Array((w + 1) * (h + 1));
		for (let y = 0; y < h; y++) {
			let row = 0;
			for (let x = 0; x < w; x++) {
				row += g[y * w + x];
				ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
			}
		}
		const r = Math.max(6, Math.round(Math.max(w, h) / 40));
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
				const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
				const v = g[y * w + x] > (sum / ((x1 - x0) * (y1 - y0))) * 0.9 ? 255 : 0;
				d[(y * w + x) * 4] = d[(y * w + x) * 4 + 1] = d[(y * w + x) * 4 + 2] = v;
			}
		}
		return;
	}
	for (let i = 0; i < g.length; i++) {
		d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.min(255, Math.max(0, ((g[i] - lo) * 255) / span));
	}
}
