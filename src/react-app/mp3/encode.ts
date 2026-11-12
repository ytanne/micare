import { Mp3Encoder } from "@breezystack/lamejs";
import type { Pcm } from "./edit";

const s16 = (x: number) => Math.round(Math.max(-1, Math.min(1, x)) * 32767);

/**
 * Encode to MP3. Converts to Int16 one chunk at a time (never a full-length copy) and
 * yields to the event loop between chunks so the UI stays responsive on long clips.
 */
export async function encodeMp3(p: Pcm, kbps = 192, onProgress?: (f: number) => void): Promise<Blob> {
	const channels = Math.min(2, p.ch.length);
	const enc = new Mp3Encoder(channels, p.rate, kbps);
	const L = p.ch[0];
	const R = channels === 2 ? p.ch[1] : undefined;
	const CHUNK = 1152 * 20;
	const l16 = new Int16Array(CHUNK);
	const r16 = R && new Int16Array(CHUNK);
	const parts: Uint8Array[] = [];
	for (let i = 0; i < L.length; i += CHUNK) {
		const len = Math.min(CHUNK, L.length - i);
		for (let k = 0; k < len; k++) {
			l16[k] = s16(L[i + k]);
			if (r16 && R) r16[k] = s16(R[i + k]);
		}
		const buf = enc.encodeBuffer(l16.subarray(0, len), r16?.subarray(0, len));
		if (buf.length) parts.push(buf.slice());
		onProgress?.(i / L.length);
		await new Promise((r) => setTimeout(r));
	}
	const tail = enc.flush();
	if (tail.length) parts.push(tail.slice());
	return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

/** 16-bit PCM WAV, built from chunks so no single giant buffer is needed. */
export function encodeWav(p: Pcm): Blob {
	const ch = p.ch.length;
	const n = p.ch[0].length;
	const head = new DataView(new ArrayBuffer(44));
	const str = (o: number, s: string) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
	str(0, "RIFF");
	head.setUint32(4, 36 + n * ch * 2, true);
	str(8, "WAVEfmt ");
	head.setUint32(16, 16, true);
	head.setUint16(20, 1, true);
	head.setUint16(22, ch, true);
	head.setUint32(24, p.rate, true);
	head.setUint32(28, p.rate * ch * 2, true);
	head.setUint16(32, ch * 2, true);
	head.setUint16(34, 16, true);
	str(36, "data");
	head.setUint32(40, n * ch * 2, true);
	const parts: BlobPart[] = [head.buffer];
	const CHUNK = 1 << 20;
	for (let i = 0; i < n; i += CHUNK) {
		const len = Math.min(CHUNK, n - i);
		const out = new Int16Array(len * ch);
		for (let k = 0; k < len; k++) for (let c = 0; c < ch; c++) out[k * ch + c] = s16(p.ch[c][i + k]);
		parts.push(out);
	}
	return new Blob(parts, { type: "audio/wav" });
}
