// Pure audio editing on raw PCM. No DOM / React / Web Audio here.

export interface Pcm {
	rate: number;
	ch: Float32Array[]; // one array per channel, equal lengths
}

export const frames = (p: Pcm) => p.ch[0]?.length ?? 0;
export const duration = (p: Pcm) => frames(p) / p.rate;

const clampIdx = (p: Pcm, t: number) => Math.max(0, Math.min(frames(p), Math.round(t * p.rate)));
const range = (p: Pcm, a: number, b: number): [number, number] => {
	const i = clampIdx(p, Math.min(a, b));
	const j = clampIdx(p, Math.max(a, b));
	return [i, j];
};
const map = (p: Pcm, f: (c: Float32Array) => Float32Array): Pcm => ({ rate: p.rate, ch: p.ch.map(f) });

/** Keep only [a, b] seconds. */
export function trim(p: Pcm, a: number, b: number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => c.slice(i, j));
}

/** Remove [a, b] seconds and join the remainder. */
export function cut(p: Pcm, a: number, b: number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => {
		const out = new Float32Array(c.length - (j - i));
		out.set(c.subarray(0, i));
		out.set(c.subarray(j), i);
		return out;
	});
}

function edit(p: Pcm, a: number, b: number, f: (x: number, k: number, n: number) => number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => {
		const out = c.slice();
		for (let k = i; k < j; k++) out[k] = f(c[k], k - i, j - i);
		return out;
	});
}

/** Multiply [a, b] by a linear factor (1 = unchanged). Clipping is hard-limited to [-1, 1]. */
export const gain = (p: Pcm, a: number, b: number, factor: number) =>
	edit(p, a, b, (x) => Math.max(-1, Math.min(1, x * factor)));

export const silence = (p: Pcm, a: number, b: number) => edit(p, a, b, () => 0);
export const fadeIn = (p: Pcm, a: number, b: number) => edit(p, a, b, (x, k, n) => x * (k / n));
export const fadeOut = (p: Pcm, a: number, b: number) => edit(p, a, b, (x, k, n) => x * (1 - k / n));

export function reverse(p: Pcm, a: number, b: number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => {
		const out = c.slice();
		for (let k = i; k < j; k++) out[k] = c[j - 1 - (k - i)];
		return out;
	});
}

/** Scale [a, b] so its loudest sample reaches `target` (0..1). */
export function normalize(p: Pcm, a: number, b: number, target = 0.98): Pcm {
	const [i, j] = range(p, a, b);
	let peak = 0;
	for (const c of p.ch) for (let k = i; k < j; k++) peak = Math.max(peak, Math.abs(c[k]));
	return peak > 0 ? gain(p, a, b, target / peak) : p;
}

export const dbToFactor = (db: number) => 10 ** (db / 20);

/** Min/max per bucket, for drawing a waveform. Uses the loudest channel per bucket. */
export function peaks(p: Pcm, buckets: number): Float32Array {
	const n = frames(p);
	const out = new Float32Array(buckets * 2);
	for (let b = 0; b < buckets; b++) {
		const s = Math.floor((b * n) / buckets);
		const e = Math.max(s + 1, Math.floor(((b + 1) * n) / buckets));
		let lo = 0;
		let hi = 0;
		for (const c of p.ch) {
			for (let k = s; k < e && k < n; k++) {
				if (c[k] < lo) lo = c[k];
				if (c[k] > hi) hi = c[k];
			}
		}
		out[b * 2] = lo;
		out[b * 2 + 1] = hi;
	}
	return out;
}

/** Linear undo/redo history of immutable snapshots. */
export class History {
	private past: Pcm[] = [];
	private future: Pcm[] = [];
	constructor(public current: Pcm) {}

	push(next: Pcm) {
		this.past.push(this.current);
		this.current = next;
		this.future = [];
	}
	undo() {
		const prev = this.past.pop();
		if (prev) {
			this.future.push(this.current);
			this.current = prev;
		}
	}
	redo() {
		const next = this.future.pop();
		if (next) {
			this.past.push(this.current);
			this.current = next;
		}
	}
	get canUndo() { return this.past.length > 0; }
	get canRedo() { return this.future.length > 0; }
}
