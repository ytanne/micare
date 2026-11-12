import { Mp3Encoder } from "@breezystack/lamejs";
import type { Pcm } from "./edit";

const toInt16 = (f: Float32Array) => {
	const out = new Int16Array(f.length);
	for (let i = 0; i < f.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
	return out;
};

/** Encode to MP3. Yields to the event loop between chunks so the UI stays responsive. */
export async function encodeMp3(p: Pcm, kbps = 192, onProgress?: (f: number) => void): Promise<Blob> {
	const channels = Math.min(2, p.ch.length);
	const enc = new Mp3Encoder(channels, p.rate, kbps);
	const left = toInt16(p.ch[0]);
	const right = channels === 2 ? toInt16(p.ch[1]) : undefined;
	const parts: Uint8Array[] = [];
	const CHUNK = 1152 * 20;
	for (let i = 0; i < left.length; i += CHUNK) {
		const buf = enc.encodeBuffer(left.subarray(i, i + CHUNK), right?.subarray(i, i + CHUNK));
		if (buf.length) parts.push(buf);
		onProgress?.(i / left.length);
		await new Promise((r) => setTimeout(r));
	}
	const tail = enc.flush();
	if (tail.length) parts.push(tail);
	return new Blob(parts as BlobPart[], { type: "audio/mpeg" });
}

/** 16-bit PCM WAV. */
export function encodeWav(p: Pcm): Blob {
	const ch = p.ch.length;
	const n = p.ch[0].length;
	const buf = new ArrayBuffer(44 + n * ch * 2);
	const v = new DataView(buf);
	const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, "RIFF");
	v.setUint32(4, 36 + n * ch * 2, true);
	str(8, "WAVEfmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, ch, true);
	v.setUint32(24, p.rate, true);
	v.setUint32(28, p.rate * ch * 2, true);
	v.setUint16(32, ch * 2, true);
	v.setUint16(34, 16, true);
	str(36, "data");
	v.setUint32(40, n * ch * 2, true);
	let o = 44;
	for (let i = 0; i < n; i++) {
		for (let c = 0; c < ch; c++) {
			v.setInt16(o, Math.round(Math.max(-1, Math.min(1, p.ch[c][i])) * 32767), true);
			o += 2;
		}
	}
	return new Blob([buf], { type: "audio/wav" });
}
