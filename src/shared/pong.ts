// Pong rules shared by the worker (authoritative simulation in the PongRoom
// Durable Object) and the browser (smoothing between snapshots). Environment
// neutral: no DOM, no Workers APIs.

export const WIDTH = 800;
export const HEIGHT = 500;
export const PADDLE_W = 12;
export const PADDLE_H = 84;
export const PADDLE_MARGIN = 24;
export const PADDLE_SPEED = 480;
export const BALL_R = 8;
export const WIN_SCORE = 7;

const BALL_START = 360;
const BALL_MAX = 900;
const BALL_ACCEL = 1.06;
const MAX_BOUNCE = Math.PI / 3;
const SERVE_DELAY = 1;

export type Side = 0 | 1; // 0 = left paddle, 1 = right paddle
export type Dir = -1 | 0 | 1;
export type Phase = "waiting" | "playing" | "over";

export interface Ball {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

export interface Game {
	phase: Phase;
	paddles: [number, number]; // paddle centre y
	ball: Ball;
	score: [number, number];
	serveIn: number; // seconds until the ball starts moving
	winner: Side | null;
}

export type Inputs = [Dir, Dir];

// Messages over the room WebSocket.
export type ClientMsg =
	| { t: "input"; dir: Dir }
	| { t: "rematch" }
	| { t: "ping" }; // keep-alive, see PongRoom.dropStale
export type ServerMsg =
	| { t: "hello"; side: Side }
	| { t: "full" }
	| {
			t: "state";
			game: Game;
			inputs: Inputs;
			rematch: [boolean, boolean];
			present: [boolean, boolean];
	  };

export function createGame(): Game {
	return {
		phase: "waiting",
		paddles: [HEIGHT / 2, HEIGHT / 2],
		ball: { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0 },
		score: [0, 0],
		serveIn: 0,
		winner: null,
	};
}

export function startGame(): Game {
	const game = createGame();
	game.phase = "playing";
	serve(game, Math.random() < 0.5 ? 0 : 1);
	return game;
}

// Put the ball in the centre, heading toward `toward`'s paddle.
function serve(game: Game, toward: Side) {
	const angle = (Math.random() * 2 - 1) * (Math.PI / 6);
	const dir = toward === 0 ? -1 : 1;
	game.ball = {
		x: WIDTH / 2,
		y: HEIGHT / 2,
		vx: dir * Math.cos(angle) * BALL_START,
		vy: Math.sin(angle) * BALL_START,
	};
	game.serveIn = SERVE_DELAY;
}

const clampPaddle = (y: number) =>
	Math.min(HEIGHT - PADDLE_H / 2, Math.max(PADDLE_H / 2, y));

function point(game: Game, scorer: Side) {
	game.score[scorer]++;
	if (game.score[scorer] >= WIN_SCORE) {
		game.phase = "over";
		game.winner = scorer;
		game.ball.vx = 0;
		game.ball.vy = 0;
		return;
	}
	serve(game, scorer === 0 ? 1 : 0); // the player who conceded receives
}

function paddleHit(game: Game, side: Side) {
	const b = game.ball;
	const py = game.paddles[side];
	const front =
		side === 0 ? PADDLE_MARGIN + PADDLE_W : WIDTH - PADDLE_MARGIN - PADDLE_W;
	const back = side === 0 ? PADDLE_MARGIN : WIDTH - PADDLE_MARGIN;
	const approaching = side === 0 ? b.vx < 0 : b.vx > 0;
	if (!approaching) return;
	const lo = Math.min(front, back);
	const hi = Math.max(front, back);
	if (b.x + BALL_R < lo || b.x - BALL_R > hi) return;
	if (Math.abs(b.y - py) > PADDLE_H / 2 + BALL_R) return;

	const offset = Math.max(-1, Math.min(1, (b.y - py) / (PADDLE_H / 2)));
	const angle = offset * MAX_BOUNCE;
	const speed = Math.min(Math.hypot(b.vx, b.vy) * BALL_ACCEL, BALL_MAX);
	b.vx = (side === 0 ? 1 : -1) * Math.cos(angle) * speed;
	b.vy = Math.sin(angle) * speed;
	b.x = side === 0 ? front + BALL_R : front - BALL_R;
}

// Advance the game by `dt` seconds. Mutates `game`.
export function step(game: Game, inputs: Inputs, dt: number) {
	if (game.phase !== "playing") return;

	for (const s of [0, 1] as const) {
		game.paddles[s] = clampPaddle(game.paddles[s] + inputs[s] * PADDLE_SPEED * dt);
	}

	if (game.serveIn > 0) {
		game.serveIn = Math.max(0, game.serveIn - dt);
		return;
	}

	const b = game.ball;
	b.x += b.vx * dt;
	b.y += b.vy * dt;

	if (b.y < BALL_R) {
		b.y = BALL_R;
		b.vy = Math.abs(b.vy);
	} else if (b.y > HEIGHT - BALL_R) {
		b.y = HEIGHT - BALL_R;
		b.vy = -Math.abs(b.vy);
	}

	paddleHit(game, 0);
	paddleHit(game, 1);

	if (b.x + BALL_R < 0) point(game, 1);
	else if (b.x - BALL_R > WIDTH) point(game, 0);
}

// Where things probably are `elapsed` seconds after a snapshot was taken, so
// the client can draw smoothly between the ~30 Hz updates.
export function project(game: Game, inputs: Inputs, elapsed: number) {
	const e = Math.min(Math.max(elapsed, 0), 0.1);
	const paddles: [number, number] = [
		clampPaddle(game.paddles[0] + inputs[0] * PADDLE_SPEED * e),
		clampPaddle(game.paddles[1] + inputs[1] * PADDLE_SPEED * e),
	];
	let { x, y } = game.ball;
	if (game.phase === "playing") {
		const moving = Math.max(0, e - game.serveIn);
		x += game.ball.vx * moving;
		y = Math.min(HEIGHT - BALL_R, Math.max(BALL_R, y + game.ball.vy * moving));
	}
	return { paddles, ball: { x, y } };
}
