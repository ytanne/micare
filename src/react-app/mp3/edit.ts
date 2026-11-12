// Pure audio editing on raw PCM. No DOM / React / Web Audio here.
//
// Samples are stored as 16-bit integers: half the memory of Float32, which matters for
// long clips (30 min stereo = ~317 MB instead of ~635 MB). Int16 is also what the MP3
// encoder wants, so export needs no conversion.

export interface Pcm {
	rate: number;
	ch: Int16Array[]; // one array per channel, equal lengths
}

export const frames = (p: Pcm) => p.ch[0]?.length ?? 0;
export const duration = (p: Pcm) => frames(p) / p.rate;

const clamp16 = (x: number) => (x > 32767 ? 32767 : x < -32768 ? -32768 : Math.round(x));

/**
 * Convert float samples (-1..1) to Int16 **in place**, reusing the same memory: no second
 * allocation, so loading a long clip doesn't need float + int copies at the same time.
 * `f` must not be used afterwards. Safe because sample i is read (bytes 4i..4i+3) before the
 * write that could touch it (bytes 2j..2j+1 with j <= i).
 */
export function floatToInt16InPlace(f: Float32Array): Int16Array {
	const out = new Int16Array(f.buffer, f.byteOffset, f.length);
	for (let i = 0; i < f.length; i++) out[i] = clamp16(f[i] * 32768);
	return out;
}

const clampIdx = (p: Pcm, t: number) => Math.max(0, Math.min(frames(p), Math.round(t * p.rate)));
const range = (p: Pcm, a: number, b: number): [number, number] => {
	const i = clampIdx(p, Math.min(a, b));
	const j = clampIdx(p, Math.max(a, b));
	return [i, j];
};
const map = (p: Pcm, f: (c: Int16Array) => Int16Array): Pcm => ({ rate: p.rate, ch: p.ch.map(f) });

/** Keep only [a, b] seconds. */
export function trim(p: Pcm, a: number, b: number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => c.slice(i, j));
}

/** Remove [a, b] seconds and join the remainder. */
export function cut(p: Pcm, a: number, b: number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => {
		const out = new Int16Array(c.length - (j - i));
		out.set(c.subarray(0, i));
		out.set(c.subarray(j), i);
		return out;
	});
}

// f receives the sample in Int16 units and returns the new value in Int16 units (clamped here).
function edit(p: Pcm, a: number, b: number, f: (x: number, k: number, n: number) => number): Pcm {
	const [i, j] = range(p, a, b);
	return map(p, (c) => {
		const out = c.slice();
		for (let k = i; k < j; k++) out[k] = clamp16(f(c[k], k - i, j - i));
		return out;
	});
}

/** Multiply [a, b] by a linear factor (1 = unchanged). Clipping is hard-limited to full scale. */
export const gain = (p: Pcm, a: number, b: number, factor: number) => edit(p, a, b, (x) => x * factor);

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

function peakInt(p: Pcm, i: number, j: number): number {
	let peak = 0;
	for (const c of p.ch) {
		for (let k = i; k < j; k++) {
			const v = c[k] < 0 ? -c[k] : c[k];
			if (v > peak) peak = v;
		}
	}
	return peak;
}

/** Scale [a, b] so its loudest sample reaches `target` (0..1). */
export function normalize(p: Pcm, a: number, b: number, target = 0.98): Pcm {
	const [i, j] = range(p, a, b);
	const peak = peakInt(p, i, j);
	return peak > 0 ? gain(p, a, b, (target * 32768) / peak) : p;
}

export const dbToFactor = (db: number) => 10 ** (db / 20);

/** Loudest sample in [a, b] seconds, in dBFS (-Infinity for silence). */
export function peakDb(p: Pcm, a: number, b: number): number {
	const [i, j] = range(p, a, b);
	return 20 * Math.log10(peakInt(p, i, j) / 32768);
}

/** Min/max (-1..1) per bucket, for drawing a waveform. Uses all channels. */
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
		out[b * 2] = lo / 32768;
		out[b * 2 + 1] = hi / 32768;
	}
	return out;
}

const peakCache = new WeakMap<Pcm, Float32Array>();
export const PEAK_BUCKETS = 8000;

/** Waveform peaks computed once per snapshot (a full pass over a long clip is expensive). */
export function cachedPeaks(p: Pcm): Float32Array {
	let pk = peakCache.get(p);
	if (!pk) peakCache.set(p, (pk = peaks(p, Math.max(1, Math.min(PEAK_BUCKETS, frames(p))))));
	return pk;
}

/** Cheap peak estimate for [a, b] from cached bucket peaks (slightly pessimistic at the edges). */
export function peakDbEstimate(p: Pcm, a: number, b: number): number {
	const pk = cachedPeaks(p);
	const n = pk.length / 2;
	const d = duration(p);
	const s = Math.max(0, Math.floor((Math.min(a, b) / d) * n));
	const e = Math.min(n, Math.max(s + 1, Math.ceil((Math.max(a, b) / d) * n)));
	let peak = 0;
	for (let k = s; k < e; k++) peak = Math.max(peak, -pk[k * 2], pk[k * 2 + 1]);
	return 20 * Math.log10(peak);
}

/** Undo/redo history of immutable snapshots. Old snapshots beyond `maxUndo` are dropped to bound memory. */
export class History {
	private past: Pcm[] = [];
	private future: Pcm[] = [];
	maxUndo = 3;
	constructor(public current: Pcm) {}

	push(next: Pcm) {
		this.past.push(this.current);
		while (this.past.length > this.maxUndo) this.past.shift();
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
