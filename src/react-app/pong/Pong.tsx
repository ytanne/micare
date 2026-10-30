import { useEffect, useRef, useState } from "react";
import {
	HEIGHT,
	PADDLE_SPEED,
	WIDTH,
	project,
	type ClientMsg,
	type Dir,
	type Game,
	type Inputs,
	type ServerMsg,
	type Side,
} from "../../shared/pong";
import type { GameProps } from "../games";
import { draw } from "./render";
import "./Pong.css";

const CODE_RE = /^[A-Z0-9]{4}$/;
// No 0/O/1/I so codes are easy to read out loud.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode() {
	let code = "";
	for (let i = 0; i < 4; i++) {
		code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
	}
	return code;
}

function Pong({ param }: GameProps) {
	const code = param?.toUpperCase();
	if (code && CODE_RE.test(code)) return <Room key={code} code={code} />;
	return <Lobby invalid={!!param} />;
}

function Lobby({ invalid }: { invalid: boolean }) {
	const [joinCode, setJoinCode] = useState("");
	const go = (c: string) => {
		window.location.hash = `#/pong/${c}`;
	};
	const joinable = CODE_RE.test(joinCode);

	return (
		<main className="pong-lobby">
			<h1>Pong Duel</h1>
			<p>Create a room and send the link to a friend, or enter a room code.</p>
			{invalid && <p className="pong-error">That room code isn’t valid.</p>}
			<button className="pong-btn primary" onClick={() => go(randomCode())}>
				Create room
			</button>
			<form
				className="pong-join"
				onSubmit={(e) => {
					e.preventDefault();
					if (joinable) go(joinCode);
				}}
			>
				<input
					value={joinCode}
					onChange={(e) =>
						setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
					}
					maxLength={4}
					placeholder="CODE"
					aria-label="Room code"
				/>
				<button className="pong-btn" type="submit" disabled={!joinable}>
					Join
				</button>
			</form>
		</main>
	);
}

type Conn = "connecting" | "open" | "full" | "closed";

interface Snapshot {
	game: Game;
	inputs: Inputs;
	at: number; // performance.now() when received
}

interface Meta {
	conn: Conn;
	side: Side | null;
	phase: Game["phase"];
	winner: Side | null;
	opponentHere: boolean;
	iVotedRematch: boolean;
}

const INITIAL_META: Meta = {
	conn: "connecting",
	side: null,
	phase: "waiting",
	winner: null,
	opponentHere: false,
	iVotedRematch: false,
};

function Room({ code }: { code: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const snapRef = useRef<Snapshot | null>(null);
	const sideRef = useRef<Side | null>(null);
	const pointerY = useRef<number | null>(null);
	const [meta, setMeta] = useState<Meta>(INITIAL_META);
	const [attempt, setAttempt] = useState(0);
	const [copied, setCopied] = useState(false);

	// Connection: one WebSocket per attempt.
	useEffect(() => {
		let disposed = false;
		let ws: WebSocket | undefined;
		let ping: ReturnType<typeof setInterval> | undefined;
		snapRef.current = null;
		sideRef.current = null;

		const onMessage = (event: MessageEvent<string>) => {
			if (disposed) return;
			const msg: ServerMsg = JSON.parse(event.data);
			if (msg.t === "full") {
				setMeta((m) => ({ ...m, conn: "full" }));
			} else if (msg.t === "hello") {
				sideRef.current = msg.side;
				setMeta((m) => ({ ...m, side: msg.side }));
			} else {
				snapRef.current = {
					game: msg.game,
					inputs: msg.inputs,
					at: performance.now(),
				};
				const side = sideRef.current;
				setMeta((m) => {
					const next: Meta = {
						...m,
						phase: msg.game.phase,
						winner: msg.game.winner,
						opponentHere: side !== null && msg.present[side === 0 ? 1 : 0],
						iVotedRematch: side !== null && msg.rematch[side],
					};
					return JSON.stringify(next) === JSON.stringify(m) ? m : next;
				});
			}
		};

		// Deferred a tick so React StrictMode's throwaway first mount never opens a socket.
		const start = setTimeout(() => {
			const proto = window.location.protocol === "https:" ? "wss" : "ws";
			const socket = new WebSocket(`${proto}://${window.location.host}/api/pong/${code}`);
			ws = socket;
			wsRef.current = socket;
			socket.onopen = () => setMeta((m) => ({ ...m, conn: "open" }));
			socket.onclose = () =>
				!disposed &&
				setMeta((m) => (m.conn === "full" ? m : { ...m, conn: "closed" }));
			socket.onmessage = onMessage;
			// The server drops connections that go silent, so keep ours alive.
			ping = setInterval(() => {
				if (socket.readyState === WebSocket.OPEN) {
					socket.send(JSON.stringify({ t: "ping" } satisfies ClientMsg));
				}
			}, 5000);
		}, 0);

		return () => {
			disposed = true;
			clearTimeout(start);
			clearInterval(ping);
			ws?.close();
		};
	}, [code, attempt]);

	// Input + render loop.
	useEffect(() => {
		const canvas = canvasRef.current!;
		const ctx = canvas.getContext("2d")!;
		const keys = new Set<string>();
		let sentDir: Dir = 0;
		let predicted: number | null = null;
		let last = performance.now();
		let raf = 0;

		const onKey = (e: KeyboardEvent, down: boolean) => {
			const k = e.key.toLowerCase();
			if (!["arrowup", "arrowdown", "w", "s"].includes(k)) return;
			e.preventDefault();
			if (down) keys.add(k);
			else keys.delete(k);
		};
		const onDown = (e: KeyboardEvent) => onKey(e, true);
		const onUp = (e: KeyboardEvent) => onKey(e, false);
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);

		const frame = (now: number) => {
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			const snap = snapRef.current;
			const side = sideRef.current;

			const up = keys.has("arrowup") || keys.has("w");
			const downKey = keys.has("arrowdown") || keys.has("s");
			let dir: Dir = up === downKey ? 0 : up ? -1 : 1;

			const view = snap ? project(snap.game, snap.inputs, (now - snap.at) / 1000) : null;
			const ownY = view && side !== null ? view.paddles[side] : null;
			if (dir === 0 && pointerY.current !== null && ownY !== null) {
				const diff = pointerY.current - (predicted ?? ownY);
				dir = Math.abs(diff) < 8 ? 0 : diff < 0 ? -1 : 1;
			}

			if (dir !== sentDir && wsRef.current?.readyState === WebSocket.OPEN) {
				sentDir = dir;
				wsRef.current.send(JSON.stringify({ t: "input", dir } satisfies ClientMsg));
			}

			if (snap && view) {
				const paddles = [...view.paddles] as [number, number];
				if (side !== null && ownY !== null) {
					// Move our own paddle immediately instead of waiting a round trip;
					// settle onto the server's value once we stop, or snap if far off.
					if (snap.game.phase !== "playing" || predicted === null) {
						predicted = ownY;
					} else {
						predicted += dir * PADDLE_SPEED * dt;
						predicted = Math.max(0, Math.min(HEIGHT, predicted));
						if (dir === 0) predicted += (ownY - predicted) * (1 - Math.exp(-dt * 10));
						if (Math.abs(predicted - ownY) > 60) predicted = ownY;
					}
					paddles[side] = predicted;
				}
				draw(ctx, {
					paddles,
					ball: view.ball,
					score: snap.game.score,
					side,
					showBall: snap.game.phase !== "waiting",
				});
			} else {
				draw(ctx, {
					paddles: [HEIGHT / 2, HEIGHT / 2],
					ball: { x: WIDTH / 2, y: HEIGHT / 2 },
					score: [0, 0],
					side: null,
					showBall: false,
				});
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
		};
	}, []);

	const toCanvasY = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		return ((e.clientY - rect.top) / rect.height) * HEIGHT;
	};

	const link = window.location.href;
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard unavailable: the link is shown on screen to copy by hand.
		}
	};

	const retry = () => {
		setMeta(INITIAL_META);
		setAttempt((a) => a + 1);
	};

	let overlay: React.ReactNode = null;
	if (meta.conn === "connecting") {
		overlay = <p>Connecting…</p>;
	} else if (meta.conn === "full") {
		overlay = (
			<>
				<p>This room already has two players.</p>
				<a className="pong-btn primary" href="#/pong">
					Back to lobby
				</a>
			</>
		);
	} else if (meta.conn === "closed") {
		overlay = (
			<>
				<p>Connection lost.</p>
				<button className="pong-btn primary" onClick={retry}>
					Reconnect
				</button>
			</>
		);
	} else if (meta.phase === "waiting" && meta.side !== null) {
		overlay = (
			<>
				<p>Waiting for a friend to join…</p>
				<p className="pong-code">{code}</p>
				<p className="pong-link">{link}</p>
				<button className="pong-btn primary" onClick={copy}>
					{copied ? "Copied!" : "Copy invite link"}
				</button>
			</>
		);
	} else if (meta.phase === "over") {
		const won = meta.winner === meta.side;
		overlay = (
			<>
				<p className="pong-result">{won ? "You win! 🎉" : "You lose"}</p>
				{meta.iVotedRematch ? (
					<p>Waiting for your opponent…</p>
				) : (
					<button
						className="pong-btn primary"
						onClick={() =>
							wsRef.current?.send(JSON.stringify({ t: "rematch" } satisfies ClientMsg))
						}
					>
						Rematch
					</button>
				)}
			</>
		);
	}

	return (
		<div className="pong">
			<p className="pong-room">
				Room <strong>{code}</strong>
				{meta.conn === "open" && meta.phase !== "waiting" && !meta.opponentHere
					? " · opponent left"
					: ""}
			</p>
			<div className="pong-stage">
				<canvas
					ref={canvasRef}
					width={WIDTH}
					height={HEIGHT}
					onPointerDown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						pointerY.current = toCanvasY(e);
					}}
					onPointerMove={(e) => {
						if (pointerY.current !== null) pointerY.current = toCanvasY(e);
					}}
					onPointerUp={() => (pointerY.current = null)}
					onPointerCancel={() => (pointerY.current = null)}
				/>
				{overlay && <div className="pong-overlay">{overlay}</div>}
			</div>
			<p className="pong-hint">W/S or ↑/↓ to move · on touch screens, press and hold where you want the paddle to go</p>
		</div>
	);
}

export default Pong;
