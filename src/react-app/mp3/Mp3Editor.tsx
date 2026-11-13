import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileDrop from "../FileDrop";
import * as E from "./edit";
import { encodeMp3, encodeWav } from "./encode";
import "./Mp3Editor.css";

const H = 160;

// Playback streams the clip in small chunks instead of building one AudioBuffer for the whole
// file (which for a 30 min clip is hundreds of MB, and gets copied again after every edit).
const CHUNK_SEC = 1; // size of each scheduled AudioBuffer
const LOOKAHEAD = 5; // keep this many seconds scheduled ahead of the playhead
const PUMP_MS = 500; // how often to top the queue up

interface Playing {
	gain: GainNode; // live volume preview
	nodes: Set<AudioBufferSourceNode>;
	when: number; // ctx time at which clip position `offset` is heard
	offset: number; // clip position (s) at `when`
	endFrame: number;
	nextFrame: number; // next frame to schedule
	timer: number;
	gainFrom: number; // gain automation is only rewritten from this ctx time on
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
	const [paused, setPaused] = useState(false);
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
		const p = playRef.current;
		if (p) {
			clearInterval(p.timer);
			for (const n of p.nodes) {
				n.onended = null;
				try { n.stop(); } catch { /* not started / already stopped */ }
			}
			p.gain.disconnect();
		}
		playRef.current = undefined;
		setPlayhead(null);
		// Stopping while paused must leave the context running for whatever plays next.
		setPaused(false);
		void ctxRef.current?.resume();
	}, []);
	useEffect(() => () => { stop(); void ctxRef.current?.close(); }, [stop]);

	// Drive the pending gain on the running GainNode: 1.0 outside the range, the slider's
	// factor inside. Rewrites only automation from `gainFrom` onwards, so audio that is
	// already queued keeps the gain it was scheduled with. The source is never restarted.
	const scheduleGain = useCallback(() => {
		const ctx = ctxRef.current;
		const p = playRef.current;
		if (!ctx || !p) return;
		const [ra, rb] = rangeRef.current;
		const factor = E.dbToFactor(pendingRef.current);
		const from = Math.max(ctx.currentTime, p.gainFrom);
		const pos = p.offset + Math.max(0, from - p.when);
		const g = p.gain.gain;
		g.cancelScheduledValues(from);
		g.setValueAtTime(pos >= ra && pos < rb ? factor : 1, from);
		if (pos < ra) g.setValueAtTime(factor, from + (ra - pos));
		if (pos < rb) g.setValueAtTime(1, from + (rb - pos));
	}, []);
	useEffect(() => {
		rangeRef.current = [a, b];
		pendingRef.current = pending;
		scheduleGain();
	}, [a, b, pending, scheduleGain]);

	const load = async (file: File) => {
		try {
			setError("");
			setNote("");
			stop();
			hist.current = undefined; // release the previous clip before decoding the next
			setSel(null);
			setPending(0);
			rerender();
			const ctx = (ctxRef.current ??= new AudioContext());
			const buf = await ctx.decodeAudioData(await file.arrayBuffer());
			// Convert to 16-bit in place (no extra allocation); edits then produce compact copies.
			const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => E.floatToInt16InPlace(buf.getChannelData(i)));
			const h = new E.History({ rate: buf.sampleRate, ch });
			const mb = (E.frames(h.current) * ch.length * 2) / 1e6;
			// Long clips: keep fewer undo snapshots, each one is a full copy.
			h.maxUndo = mb > 150 ? 1 : 3;
			hist.current = h;
			if (mb > 150) setNote(`Large file (~${Math.round(mb)} MB in memory): undo history is limited to ${h.maxUndo} step.`);
			setName(file.name);
			rerender();
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : "Could not decode that file.") +
					" Very long files can run out of memory; try a shorter or lower-quality file.",
			);
		}
	};

	// Schedule enough chunks to stay `LOOKAHEAD` seconds ahead. Always reads the *current* snapshot,
	// so after "Apply" the not-yet-queued audio comes from the edited clip without restarting.
	const pump = useCallback(() => {
		const p = playRef.current;
		const ctx = ctxRef.current;
		const src = hist.current?.current;
		if (!p || !ctx || !src) return;
		const chunk = Math.round(CHUNK_SEC * src.rate);
		const total = E.frames(src);
		while (p.nextFrame < Math.min(p.endFrame, total) && p.when + (p.nextFrame / src.rate - p.offset) < ctx.currentTime + LOOKAHEAD) {
			const f0 = p.nextFrame;
			const f1 = Math.min(p.endFrame, total, f0 + chunk);
			const buf = ctx.createBuffer(src.ch.length, f1 - f0, src.rate);
			src.ch.forEach((c, i) => {
				const out = buf.getChannelData(i);
				for (let k = 0; k < out.length; k++) out[k] = c[f0 + k] / 32768;
			});
			const node = ctx.createBufferSource();
			node.buffer = buf;
			node.connect(p.gain);
			node.start(p.when + (f0 / src.rate - p.offset));
			p.nodes.add(node);
			node.onended = () => {
				p.nodes.delete(node);
				if (playRef.current === p && p.nextFrame >= p.endFrame && p.nodes.size === 0) stop();
			};
			p.nextFrame = f1;
		}
	}, [stop]);

	const play = () => {
		if (!pcm) return;
		stop();
		const ctx = (ctxRef.current ??= new AudioContext());
		void ctx.resume();
		const startFrame = Math.max(0, Math.round(a * pcm.rate));
		const endFrame = Math.min(E.frames(pcm), Math.round(b * pcm.rate));
		if (endFrame <= startFrame) return;
		const gain = ctx.createGain();
		gain.connect(ctx.destination);
		const p: Playing = {
			gain,
			nodes: new Set(),
			when: ctx.currentTime + 0.05,
			offset: startFrame / pcm.rate,
			endFrame,
			nextFrame: startFrame,
			timer: window.setInterval(pump, PUMP_MS),
			gainFrom: 0,
		};
		playRef.current = p;
		pump();
		scheduleGain();
		const tick = () => {
			const cur = playRef.current;
			if (!cur) return;
			setPlayhead(cur.offset + Math.max(0, ctx.currentTime - cur.when));
			raf.current = requestAnimationFrame(tick);
		};
		tick();
	};

	// Pause by suspending the context: currentTime and every queued chunk freeze together, so the
	// playhead, chunk queue and volume automation (all keyed to currentTime) resume exactly in place.
	const pause = () => {
		setPaused(true);
		void ctxRef.current?.suspend();
	};
	const resume = () => {
		setPaused(false);
		void ctxRef.current?.resume();
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

	// Bake the slider's gain into the audio. If playing, playback carries on: chunks already
	// queued keep the live gain, later chunks are read from the baked audio at unity gain.
	const commitGain = () => {
		if (!pcm || pending === 0 || b - a <= 0) return;
		const p = playRef.current;
		if (p) p.gainFrom = p.when + (p.nextFrame / pcm.rate - p.offset);
		hist.current!.push(E.gain(pcm, a, b, E.dbToFactor(pending)));
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
		// Resizing reallocates the backing store, so only do it when the size really changed
		// (this effect runs every animation frame during playback).
		const pw = Math.round(w * dpr);
		const ph = Math.round(H * dpr);
		if (c.width !== pw || c.height !== ph) {
			c.width = pw;
			c.height = ph;
		}
		const g = c.getContext("2d")!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
						{playhead == null ? (
							<button onClick={play}>▶ Play</button>
						) : (
							<>
								<button onClick={paused ? resume : pause}>{paused ? "▶ Resume" : "⏸ Pause"}</button>
								<button onClick={stop}>■ Stop</button>
							</>
						)}
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
