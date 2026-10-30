import { DurableObject } from "cloudflare:workers";
import {
	createGame,
	startGame,
	step,
	type ClientMsg,
	type Dir,
	type Game,
	type Inputs,
	type ServerMsg,
	type Side,
} from "../shared/pong";

const TICK_MS = 1000 / 60;
const SEND_EVERY = 2; // broadcast every Nth tick (~30 Hz)
const WATCHDOG_MS = 5000;
const STALE_MS = 15000; // clients ping every 5 s; silence this long means a dead link

// One instance per room code. Holds both players' sockets and runs the
// authoritative game loop; clients only send paddle input.
export class PongRoom extends DurableObject<Env> {
	private sockets: (WebSocket | null)[] = [null, null];
	private game: Game = createGame();
	private inputs: Inputs = [0, 0];
	private rematch: [boolean, boolean] = [false, false];
	private lastSeen = [0, 0];
	private timer: ReturnType<typeof setInterval> | undefined;
	private watchdog: ReturnType<typeof setInterval> | undefined;
	private lastTick = 0;
	private frame = 0;

	async fetch(): Promise<Response> {
		const [client, server] = Object.values(new WebSocketPair());
		server.accept();

		const side = this.sockets.indexOf(null);
		if (side === -1) {
			this.send(server, { t: "full" });
			server.close(1008, "Room full");
		} else {
			this.join(server, side as Side);
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	private join(ws: WebSocket, side: Side) {
		this.sockets[side] = ws;
		this.lastSeen[side] = Date.now();
		this.send(ws, { t: "hello", side });
		this.watchdog ??= setInterval(() => this.dropStale(), WATCHDOG_MS);

		ws.addEventListener("message", (event) => {
			this.lastSeen[side] = Date.now();
			if (typeof event.data !== "string") return;
			let msg: ClientMsg;
			try {
				msg = JSON.parse(event.data);
			} catch {
				return;
			}
			if (msg.t === "ping") {
				return;
			} else if (msg.t === "input") {
				if (msg.dir === -1 || msg.dir === 0 || msg.dir === 1) {
					this.inputs[side] = msg.dir as Dir;
				}
			} else if (msg.t === "rematch" && this.game.phase === "over") {
				this.rematch[side] = true;
				if (this.rematch[0] && this.rematch[1]) {
					this.rematch = [false, false];
					this.game = startGame();
					this.syncLoop();
				}
				this.broadcast();
			}
		});

		ws.addEventListener("close", () => this.leave(side, ws));
		ws.addEventListener("error", () => this.leave(side, ws));

		if (this.sockets[0] && this.sockets[1] && this.game.phase === "waiting") {
			this.game = startGame();
		}
		this.syncLoop();
		this.broadcast();
	}

	private leave(side: Side, ws: WebSocket) {
		if (this.sockets[side] !== ws) return;
		this.sockets[side] = null;
		// Anyone leaving ends the match; whoever remains waits for a new opponent.
		this.game = createGame();
		this.inputs = [0, 0];
		this.rematch = [false, false];
		if (!this.sockets[0] && !this.sockets[1] && this.watchdog) {
			clearInterval(this.watchdog);
			this.watchdog = undefined;
		}
		this.syncLoop();
		this.broadcast();
	}

	// Connections that die without a close frame (crashed tab, lost network)
	// would otherwise hold a seat forever.
	private dropStale() {
		for (const side of [0, 1] as const) {
			const ws = this.sockets[side];
			if (ws && Date.now() - this.lastSeen[side] > STALE_MS) {
				try {
					ws.close(1001, "Timed out");
				} catch {
					// Already gone.
				}
				this.leave(side, ws);
			}
		}
	}

	// Run the tick timer only while a match is in progress.
	private syncLoop() {
		const playing = this.game.phase === "playing";
		if (playing && !this.timer) {
			this.lastTick = Date.now();
			this.timer = setInterval(() => this.tick(), TICK_MS);
		} else if (!playing && this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private tick() {
		const now = Date.now();
		const dt = Math.min((now - this.lastTick) / 1000, 0.05);
		this.lastTick = now;
		step(this.game, this.inputs, dt);

		if (this.game.phase !== "playing") {
			this.syncLoop();
			this.broadcast();
		} else if (++this.frame % SEND_EVERY === 0) {
			this.broadcast();
		}
	}

	private broadcast() {
		const msg: ServerMsg = {
			t: "state",
			game: this.game,
			inputs: this.inputs,
			rematch: this.rematch,
			present: [this.sockets[0] !== null, this.sockets[1] !== null],
		};
		const data = JSON.stringify(msg);
		for (const ws of this.sockets) {
			try {
				ws?.send(data);
			} catch {
				// A dead socket is cleaned up by its close/error listener.
			}
		}
	}

	private send(ws: WebSocket, msg: ServerMsg) {
		ws.send(JSON.stringify(msg));
	}
}
