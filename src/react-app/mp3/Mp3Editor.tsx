import { useCallback, useEffect, useRef, useState } from "react";
import * as E from "./edit";
import { encodeMp3, encodeWav } from "./encode";
import "./Mp3Editor.css";

const H = 160;

export default function Mp3Editor() {
	const hist = useRef<E.History>(undefined);
	const [, bump] = useState(0);
	const rerender = () => bump((n) => n + 1);
	const [name, setName] = useState("audio.mp3");
	const [sel, setSel] = useState<[number, number] | null>(null);
	const [db, setDb] = useState(3);
	const [kbps, setKbps] = useState(192);
	const [playhead, setPlayhead] = useState<number | null>(null);
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const canvas = useRef<HTMLCanvasElement>(null);
	const ctxRef = useRef<AudioContext>(undefined);
	const srcRef = useRef<AudioBufferSourceNode>(undefined);
	const raf = useRef(0);
	const drag = useRef<number | null>(null);

	const pcm = hist.current?.current;
	const dur = pcm ? E.duration(pcm) : 0;
	// No selection means "the whole clip".
	const [a, b] = sel ?? [0, dur];

	const stop = useCallback(() => {
		cancelAnimationFrame(raf.current);
		try { srcRef.current?.stop(); } catch { /* already stopped */ }
		srcRef.current = undefined;
		setPlayhead(null);
	}, []);
	useEffect(() => () => { stop(); void ctxRef.current?.close(); }, [stop]);

	const load = async (file: File) => {
		try {
			setError("");
			stop();
			const ctx = (ctxRef.current ??= new AudioContext());
			const buf = await ctx.decodeAudioData(await file.arrayBuffer());
			const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
			hist.current = new E.History({ rate: buf.sampleRate, ch });
			setName(file.name);
			setSel(null);
			rerender();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not decode that file.");
		}
	};

	const play = () => {
		if (!pcm) return;
		stop();
		const ctx = (ctxRef.current ??= new AudioContext());
		void ctx.resume();
		const buf = ctx.createBuffer(pcm.ch.length, E.frames(pcm), pcm.rate);
		pcm.ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
		const node = ctx.createBufferSource();
		node.buffer = buf;
		node.connect(ctx.destination);
		const start = ctx.currentTime;
		node.onended = () => { if (srcRef.current === node) stop(); };
		node.start(0, a, Math.max(0.01, b - a));
		srcRef.current = node;
		const tick = () => {
			setPlayhead(a + ctx.currentTime - start);
			raf.current = requestAnimationFrame(tick);
		};
		tick();
	};

	// Apply an edit to the selection (or whole clip), pushing an undo step.
	const apply = (f: (p: E.Pcm, a: number, b: number) => E.Pcm, after?: "clear") => {
		if (!pcm || b - a <= 0) return;
		stop();
		hist.current!.push(f(pcm, a, b));
		if (after === "clear") setSel(null);
		rerender();
	};
	const undoRedo = (k: "undo" | "redo") => {
		stop();
		hist.current![k]();
		setSel(null);
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
		const pk = E.peaks(pcm, Math.max(1, Math.floor(w)));
		g.fillStyle = css.getPropertyValue("--wave");
		for (let i = 0; i < w; i++) {
			const lo = pk[i * 2] * (H / 2);
			const hi = pk[i * 2 + 1] * (H / 2);
			g.fillRect(i, H / 2 - hi, 1, Math.max(1, hi - lo));
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

	return (
		<div className="mp3">
			<h1>🎚️ MP3 Editor</h1>
			<input type="file" accept="audio/*,.mp3" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
			{error && <p role="alert">{error}</p>}
			{pcm && (
				<>
					<canvas
						ref={canvas}
						style={{ height: H }}
						onPointerDown={(e) => {
							e.currentTarget.setPointerCapture(e.pointerId);
							drag.current = timeAt(e);
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
						<label>
							Volume{" "}
							<input type="number" step={1} value={db} onChange={(e) => setDb(+e.target.value)} /> dB
						</label>
						<button onClick={() => apply((p, s, t) => E.gain(p, s, t, E.dbToFactor(db)))}>Apply volume</button>
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
