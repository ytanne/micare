import { useCallback, useEffect, useRef, useState } from "react";
import {
	H,
	MAX_LEVEL,
	W,
	createGame,
	damageBoss,
	nextLevel,
	skipToBoss,
	startGame,
	update,
	type GameEvent,
	type Input,
	type Phase,
} from "./engine";
import { draw } from "./render";
import "./Shooter.css";

const TOUCH_OFFSET_Y = 70; // keep the ship visible above the finger

const KEYS: Record<string, keyof Omit<Input, "target">> = {
	ArrowLeft: "left",
	a: "left",
	A: "left",
	ArrowRight: "right",
	d: "right",
	D: "right",
	ArrowUp: "up",
	w: "up",
	W: "up",
	ArrowDown: "down",
	s: "down",
	S: "down",
};

const TONES: Record<GameEvent, [number, number, OscillatorType]> = {
	shoot: [880, 0.04, "square"],
	explode: [120, 0.15, "sawtooth"],
	hit: [80, 0.4, "sawtooth"],
	bossHit: [220, 0.05, "square"],
	pickup: [1200, 0.15, "sine"],
	levelComplete: [660, 0.6, "triangle"],
	victory: [880, 1, "triangle"],
	gameOver: [60, 0.8, "sawtooth"],
};

interface Ui {
	phase: Phase;
	level: number;
	score: number;
	best: number;
}

function Shooter() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const game = useRef(createGame());
	const input = useRef<Input>({ left: false, right: false, up: false, down: false, target: null });
	const paused = useRef(false);
	const audio = useRef<AudioContext | null>(null);
	const muted = useRef(false);
	const [ui, setUi] = useState<Ui>({ phase: "menu", level: 1, score: 0, best: game.current.best });
	const [isPaused, setIsPaused] = useState(false);
	const [isMuted, setIsMuted] = useState(false);

	const beep = useCallback((ev: GameEvent) => {
		const ctx = audio.current;
		if (!ctx || muted.current) return;
		const [freq, dur, type] = TONES[ev];
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = type;
		osc.frequency.value = freq;
		gain.gain.setValueAtTime(0.04, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
		osc.connect(gain).connect(ctx.destination);
		osc.start();
		osc.stop(ctx.currentTime + dur);
	}, []);

	const unlockAudio = () => {
		try {
			audio.current ??= new AudioContext();
			void audio.current.resume();
		} catch {
			/* audio unsupported */
		}
	};

	const togglePause = useCallback(() => {
		if (game.current.phase !== "playing") return;
		paused.current = !paused.current;
		setIsPaused(paused.current);
	}, []);

	const start = () => {
		unlockAudio();
		startGame(game.current);
		paused.current = false;
		setIsPaused(false);
	};

	// Game loop.
	useEffect(() => {
		const canvas = canvasRef.current!;
		const ctx = canvas.getContext("2d")!;
		const g = game.current;
		let raf = 0;
		let last = performance.now();
		let lastUi = "";

		const frame = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			if (!paused.current) update(g, dt, input.current);
			for (const ev of g.events) beep(ev);
			g.events.length = 0;
			draw(ctx, g, now / 1000);

			const key = `${g.phase}|${g.level}|${g.score}|${g.best}`;
			if (key !== lastUi) {
				lastUi = key;
				setUi({ phase: g.phase, level: g.level, score: g.score, best: g.best });
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, [beep]);

	// Fit the fixed-ratio canvas into the available space, crisp on hi-dpi screens.
	useEffect(() => {
		const box = boxRef.current!;
		const canvas = canvasRef.current!;
		const fit = () => {
			const scale = Math.min(box.clientWidth / W, box.clientHeight / H);
			const dpr = window.devicePixelRatio || 1;
			canvas.style.width = `${W * scale}px`;
			canvas.style.height = `${H * scale}px`;
			canvas.width = Math.round(W * scale * dpr);
			canvas.height = Math.round(H * scale * dpr);
			canvas.getContext("2d")!.setTransform((scale * dpr), 0, 0, scale * dpr, 0, 0);
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(box);
		return () => ro.disconnect();
	}, []);

	// Keyboard and auto-pause when the tab is hidden.
	useEffect(() => {
		const onKey = (e: KeyboardEvent, down: boolean) => {
			const dir = KEYS[e.key];
			if (dir) {
				input.current[dir] = down;
				e.preventDefault();
			} else if (down && (e.key === "p" || e.key === "P" || e.key === "Escape")) {
				togglePause();
			} else if (down && e.key === " ") {
				e.preventDefault(); // firing is automatic; avoid page scroll
			}
		};
		const kd = (e: KeyboardEvent) => onKey(e, true);
		const ku = (e: KeyboardEvent) => onKey(e, false);
		const onHide = () => {
			if (document.hidden && game.current.phase === "playing") {
				paused.current = true;
				setIsPaused(true);
			}
		};
		window.addEventListener("keydown", kd);
		window.addEventListener("keyup", ku);
		document.addEventListener("visibilitychange", onHide);
		return () => {
			window.removeEventListener("keydown", kd);
			window.removeEventListener("keyup", ku);
			document.removeEventListener("visibilitychange", onHide);
		};
	}, [togglePause]);

	// Debug hooks for automated testing: open the page with ?debug.
	useEffect(() => {
		if (!new URLSearchParams(window.location.search).has("debug")) return;
		const g = game.current;
		g.godMode = true;
		Object.assign(window, {
			__shooter: { game: g, skipToBoss: () => skipToBoss(g), damageBoss: (n: number) => damageBoss(g, n) },
		});
	}, []);

	// Drag to steer (touch and mouse).
	const aim = (e: React.PointerEvent) => {
		const rect = canvasRef.current!.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * W;
		const y = ((e.clientY - rect.top) / rect.height) * H;
		input.current.target = { x, y: y - (e.pointerType === "touch" ? TOUCH_OFFSET_Y : 0) };
	};
	const onDown = (e: React.PointerEvent) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		aim(e);
	};
	const onMove = (e: React.PointerEvent) => {
		if (input.current.target) aim(e);
	};
	const onUp = () => {
		input.current.target = null;
	};

	const toggleMute = () => {
		muted.current = !muted.current;
		setIsMuted(muted.current);
	};

	return (
		<div className="shooter">
			<div className="shooter-box" ref={boxRef}>
				<div className="shooter-stage">
					<canvas
						ref={canvasRef}
						onPointerDown={onDown}
						onPointerMove={onMove}
						onPointerUp={onUp}
						onPointerCancel={onUp}
					/>
					{ui.phase === "playing" && (
						<div className="shooter-buttons">
							<button onClick={toggleMute} aria-label="Toggle sound">
								{isMuted ? "🔇" : "🔊"}
							</button>
							<button onClick={togglePause} aria-label="Pause">
								{isPaused ? "▶" : "⏸"}
							</button>
						</div>
					)}
					{ui.phase === "menu" && (
						<div className="shooter-overlay">
							<h2>Star Defender</h2>
							<p>Destroy the alien fleet and beat the boss of each of the 3 levels.</p>
							<p className="hint">
								Touch: drag to fly — your ship fires automatically.
								<br />
								Keyboard: arrows / WASD to move, P to pause.
							</p>
							{ui.best > 0 && <p>Best score: {ui.best}</p>}
							<button className="primary" onClick={start}>
								Tap to start
							</button>
						</div>
					)}
					{ui.phase === "playing" && isPaused && (
						<div className="shooter-overlay">
							<h2>Paused</h2>
							<button className="primary" onClick={togglePause}>
								Resume
							</button>
						</div>
					)}
					{ui.phase === "levelComplete" && (
						<div className="shooter-overlay" onClick={() => nextLevel(game.current)}>
							<h2>🎉 Congratulations!</h2>
							<p>Level {ui.level} complete — the boss is down!</p>
							<p>Score: {ui.score}</p>
							<p className="hint">Level {ui.level + 1} of {MAX_LEVEL} begins… (tap to skip)</p>
						</div>
					)}
					{ui.phase === "gameOver" && (
						<div className="shooter-overlay">
							<h2>Game over</h2>
							<p>You reached level {ui.level}.</p>
							<p>Score: {ui.score} · Best: {ui.best}</p>
							<button className="primary" onClick={start}>
								Try again
							</button>
						</div>
					)}
					{ui.phase === "victory" && (
						<div className="shooter-overlay">
							<h2>🏆 Victory!</h2>
							<p>You destroyed the final boss and saved the galaxy.</p>
							<p>Final score: {ui.score} · Best: {ui.best}</p>
							<button className="primary" onClick={start}>
								Play again
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default Shooter;
