import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileDrop from "../FileDrop";
import * as E from "./edit";
import { encodeMp3, encodeWav } from "./encode";
import "./Mp3Editor.css";

const H = 160;
// Small lead time so a seamless source hand-off is scheduled sample-accurately.
const HANDOFF = 0.03;

// One AudioBuffer per snapshot, built lazily. The freshly decoded clip reuses the decoder's own
// buffer, so playing an unedited file costs no extra memory. Entries are freed with the snapshot.
const bufCache = new WeakMap<E.Pcm, AudioBuffer>();
function audioBufferFor(ctx: AudioContext, p: E.Pcm): AudioBuffer {
	let buf = bufCache.get(p);
	if (!buf) {
		buf = ctx.createBuffer(p.ch.length, E.frames(p), p.rate);
		p.ch.forEach((c, i) => buf!.copyToChannel(c as Float32Array<ArrayBuffer>, i));
		bufCache.set(p, buf);
	}
	return buf;
}

interface Playing {
	node: AudioBufferSourceNode;
	gain: GainNode;
	when: number; // ctx time the source starts producing sound
	offset: number; // clip position (s) at `when`
	end: number; // clip position (s) where playback stops
}

export default function Mp3Editor() {
	const hist = useRef<E.History>(undefined);
	const [, bump] = useState(0);
	const rerender = () => bump((n) => n + 1);
	const [name, setName] = useState("audio.mp3");
	const [sel, setSel] = useState<[number, number] | null>(null);
	// Pending volume change in dB. Previewed live; baked into the audio by "Apply".
	const [pending, setPending] = useState(0);
	const [kbps, setKbps] = useState(192);
	const [playhead, setPlayhead] = useState<number | null>(null);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const canvas = useRef<HTMLCanvasElement>(null);
	const ctxRef = useRef<AudioContext>(undefined);
	const playRef = useRef<Playing>(undefined);
	const rangeRef = useRef<[number, number]>([0, 0]);
	const pendingRef = useRef(0);
	const raf = useRef(0);
	const drag = useRef<number | null>(null);

	const pcm = hist.current?.current;
	const dur = pcm ? E.duration(pcm) : 0;
	// No selection means "the whole clip".
	const [a, b] = sel ?? [0, dur];

	// Exact for small ranges; a bucket-based estimate otherwise (a full scan on every drag move would freeze long clips).
	const peak = useMemo(() => {
		if (!pcm) return -Infinity;
		return (b - a) * pcm.rate * pcm.ch.length <= 4e6 ? E.peakDb(pcm, a, b) : E.peakDbEstimate(pcm, a, b);
	}, [pcm, a, b]);
	const clips = peak + pending > 0;

	const stop = useCallback(() => {
		cancelAnimationFrame(raf.current);
		try { playRef.current?.node.stop(); } catch { /* already stopped */ }
		playRef.current = undefined;
		setPlayhead(null);
	}, []);
	useEffect(() => () => { stop(); void ctxRef.current?.close(); }, [stop]);

	// Drive the pending gain on the running GainNode: 1.0 outside the range,
	// the slider's factor inside. Re-run whenever the slider or range changes;
	// the source is never restarted, so playback is uninterrupted.
	const scheduleGain = useCallback(() => {
		const ctx = ctxRef.current;
		const p = playRef.current;
		if (!ctx || !p) return;
		const [ra, rb] = rangeRef.current;
		const factor = E.dbToFactor(pendingRef.current);
		const now = ctx.currentTime;
		const pos = p.offset + Math.max(0, now - p.when);
		const g = p.gain.gain;
		g.cancelScheduledValues(now);
		g.setValueAtTime(pos >= ra && pos < rb ? factor : 1, now);
		if (pos < ra) g.setValueAtTime(factor, now + (ra - pos));
		if (pos < rb) g.setValueAtTime(1, now + (rb - pos));
	}, []);
	useEffect(() => {
		rangeRef.current = [a, b];
		pendingRef.current = pending;
		scheduleGain();
	}, [a, b, pending, scheduleGain]);

	const load = async (file: File) => {
		try {
			setError("");
			stop();
			const ctx = (ctxRef.current ??= new AudioContext());
			const buf = await ctx.decodeAudioData(await file.arrayBuffer());
			// Views into the decoded buffer: no second copy of the whole clip.
			const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
			const first: E.Pcm = { rate: buf.sampleRate, ch };
			bufCache.set(first, buf);
			const h = new E.History(first);
			const mb = (E.frames(first) * ch.length * 4) / 1e6;
			// Long clips: keep fewer undo snapshots, each one is a full copy.
			h.maxUndo = mb > 300 ? 1 : 3;
			hist.current = h;
			setNote(mb > 300 ? `Large file (~${Math.round(mb)} MB in memory): undo history is limited to ${h.maxUndo} step.` : "");
			setName(file.name);
			setSel(null);
			setPending(0);
			rerender();
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : "Could not decode that file.") +
					" Very long files can run out of memory; try a shorter or lower-quality file.",
			);
		}
	};

	// Start `p` at clip position `offset`, `delay` seconds from now, and track it as the current playback.
	const startAt = (p: E.Pcm, offset: number, end: number, delay = 0) => {
		const ctx = (ctxRef.current ??= new AudioContext());
		void ctx.resume();
		const node = ctx.createBufferSource();
		node.buffer = audioBufferFor(ctx, p);
		const gain = ctx.createGain();
		node.connect(gain).connect(ctx.destination);
		const when = ctx.currentTime + delay;
		node.start(when, offset, Math.max(0.01, end - offset));
		node.onended = () => { if (playRef.current?.node === node) stop(); };
		playRef.current = { node, gain, when, offset, end };
	};

	const play = () => {
		if (!pcm) return;
		stop();
		startAt(pcm, a, b);
		scheduleGain();
		const tick = () => {
			const p = playRef.current;
			if (!p) return;
			setPlayhead(p.offset + Math.max(0, ctxRef.current!.currentTime - p.when));
			raf.current = requestAnimationFrame(tick);
		};
		tick();
	};

	// Apply an edit to the selection (or whole clip), pushing an undo step.
	const apply = (f: (p: E.Pcm, a: number, b: number) => E.Pcm, after?: "clear") => {
		if (!pcm || b - a <= 0) return;
		stop();
		hist.current!.push(f(pcm, a, b));
		setPending(0);
		if (after === "clear") setSel(null);
		rerender();
	};

	// Bake the slider's gain into the audio. If playing, hand off to the new
	// audio at the same position so the music doesn't restart.
	const commitGain = () => {
		if (!pcm || pending === 0 || b - a <= 0) return;
		const next = E.gain(pcm, a, b, E.dbToFactor(pending));
		const cur = playRef.current;
		if (cur) {
			const ctx = ctxRef.current!;
			const pos = cur.offset + Math.max(0, ctx.currentTime - cur.when) + HANDOFF;
			if (pos < cur.end) {
				const old = cur.node;
				startAt(next, pos, cur.end, HANDOFF);
				old.stop(playRef.current!.when);
			} else {
				stop();
			}
		}
		hist.current!.push(next);
		pendingRef.current = 0;
		setPending(0);
		rerender();
	};

	const undoRedo = (k: "undo" | "redo") => {
		stop();
		hist.current![k]();
		setSel(null);
		setPending(0);
		rerender();
	};

	const save = async (kind: "mp3" | "wav") => {
		if (!pcm) return;
		setBusy("Encoding…");
		try {
			const blob = kind === "wav" ? encodeWav(pcm) : await encodeMp3(pcm, kbps, (f) => setBusy(`Encoding ${Math.round(f * 100)}%`));
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = name.replace(/\.[^.]+$/, "") + "-edited." + kind;
			link.click();
			URL.revokeObjectURL(link.href);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		setBusy("");
	};

	// Waveform drawing.
	useEffect(() => {
		const c = canvas.current;
		if (!c || !pcm) return;
		const w = c.clientWidth;
		const dpr = window.devicePixelRatio || 1;
		c.width = w * dpr;
		c.height = H * dpr;
		const g = c.getContext("2d")!;
		g.scale(dpr, dpr);
		const css = getComputedStyle(c);
		g.clearRect(0, 0, w, H);
		const x = (t: number) => (t / dur) * w;
		if (sel) {
			g.fillStyle = css.getPropertyValue("--sel");
			g.fillRect(x(sel[0]), 0, x(sel[1]) - x(sel[0]), H);
		}
		// Cached per snapshot; repainting for the playhead is O(width), not O(samples).
		const pk = E.cachedPeaks(pcm);
		const nb = pk.length / 2;
		g.fillStyle = css.getPropertyValue("--wave");
		for (let i = 0; i < w; i++) {
			const s = Math.floor((i * nb) / w);
			const e = Math.min(nb, Math.max(s + 1, Math.floor(((i + 1) * nb) / w)));
			let lo = 0;
			let hi = 0;
			for (let k = s; k < e; k++) {
				lo = Math.min(lo, pk[k * 2]);
				hi = Math.max(hi, pk[k * 2 + 1]);
			}
			g.fillRect(i, H / 2 - hi * (H / 2), 1, Math.max(1, (hi - lo) * (H / 2)));
		}
		if (playhead != null) {
			g.fillStyle = css.getPropertyValue("--head");
			g.fillRect(x(playhead), 0, 2, H);
		}
	}, [pcm, sel, playhead, dur]);

	const timeAt = (e: React.PointerEvent) => {
		const r = e.currentTarget.getBoundingClientRect();
		return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur));
	};

	const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
	const h = hist.current;
	const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

	return (
		<div className="mp3">
			<h1>🎚️ MP3 Editor</h1>
			<FileDrop accept="audio/*,.mp3" onFile={load} label="Drop an MP3 here, or click to choose" fileName={pcm ? name : undefined} />
			{error && <p role="alert">{error}</p>}
			{note && <p className="mp3-info">{note}</p>}
			{pcm && (
				<>
					<canvas
						ref={canvas}
						style={{ height: H }}
						onPointerDown={(e) => {
							e.currentTarget.setPointerCapture(e.pointerId);
							drag.current = timeAt(e);
							stop();
							setSel(null);
						}}
						onPointerMove={(e) => {
							if (drag.current == null) return;
							const t = timeAt(e);
							setSel(Math.abs(t - drag.current) * pcm.rate > 8 ? [Math.min(drag.current, t), Math.max(drag.current, t)] : null);
						}}
						onPointerUp={() => { drag.current = null; }}
					/>
					<p className="mp3-info">
						{fmt(dur)} total · {sel ? `selected ${fmt(a)} – ${fmt(b)} (${(b - a).toFixed(2)}s)` : "no selection — edits apply to the whole clip; drag the waveform to select"}
					</p>
					<div className="mp3-row">
						<button onClick={playhead == null ? play : stop}>{playhead == null ? "▶ Play" : "■ Stop"}</button>
						<button disabled={!h?.canUndo} onClick={() => undoRedo("undo")}>Undo</button>
						<button disabled={!h?.canRedo} onClick={() => undoRedo("redo")}>Redo</button>
					</div>
					<div className="mp3-row">
						<button disabled={!sel} onClick={() => apply(E.trim, "clear")}>Trim to selection</button>
						<button disabled={!sel} onClick={() => apply(E.cut, "clear")}>Cut selection</button>
						<button onClick={() => apply(E.silence)}>Silence</button>
						<button onClick={() => apply(E.fadeIn)}>Fade in</button>
						<button onClick={() => apply(E.fadeOut)}>Fade out</button>
						<button onClick={() => apply(E.reverse)}>Reverse</button>
						<button onClick={() => apply((p, s, t) => E.normalize(p, s, t))}>Normalize</button>
					</div>
					<div className="mp3-row">
						<label className="mp3-slider">
							Volume
							<input
								type="range"
								min={-24}
								max={12}
								step={0.5}
								value={pending}
								onChange={(e) => setPending(+e.target.value)}
							/>
							<output>{signed(pending)} dB</output>
						</label>
						<button disabled={pending === 0} onClick={commitGain}>Apply</button>
						<button disabled={pending === 0} onClick={() => setPending(0)}>Reset</button>
						<span className={clips ? "mp3-clip" : "mp3-info"}>
							Peak {Number.isFinite(peak) ? `${(peak + pending).toFixed(1)} dB` : "—"}
							{clips && " — will clip"}
						</span>
					</div>
					<div className="mp3-row">
						<label>
							Bitrate{" "}
							<select value={kbps} onChange={(e) => setKbps(+e.target.value)}>
								{[128, 192, 256, 320].map((k) => <option key={k} value={k}>{k} kbps</option>)}
							</select>
						</label>
						<button disabled={!!busy} onClick={() => save("mp3")}>Export MP3</button>
						<button disabled={!!busy} onClick={() => save("wav")}>Export WAV</button>
						{busy && <span>{busy}</span>}
					</div>
				</>
			)}
		</div>
	);
}
