// Canvas drawing for Pong. Pure function of a view of the game; no networking.

import {
	BALL_R,
	HEIGHT,
	PADDLE_H,
	PADDLE_MARGIN,
	PADDLE_W,
	WIDTH,
	type Side,
} from "../../shared/pong";

export interface View {
	paddles: [number, number];
	ball: { x: number; y: number };
	score: [number, number];
	side: Side | null; // which paddle belongs to this player
	showBall: boolean;
}

const COLORS = ["#22d3ee", "#f97316"];

export function draw(ctx: CanvasRenderingContext2D, v: View) {
	ctx.fillStyle = "#0b1120";
	ctx.fillRect(0, 0, WIDTH, HEIGHT);

	ctx.strokeStyle = "#374151";
	ctx.lineWidth = 4;
	ctx.setLineDash([14, 14]);
	ctx.beginPath();
	ctx.moveTo(WIDTH / 2, 0);
	ctx.lineTo(WIDTH / 2, HEIGHT);
	ctx.stroke();
	ctx.setLineDash([]);

	ctx.font = "bold 56px system-ui, sans-serif";
	ctx.textAlign = "center";
	ctx.fillStyle = "#4b5563";
	ctx.fillText(String(v.score[0]), WIDTH / 2 - 70, 70);
	ctx.fillText(String(v.score[1]), WIDTH / 2 + 70, 70);

	for (const s of [0, 1] as const) {
		const x = s === 0 ? PADDLE_MARGIN : WIDTH - PADDLE_MARGIN - PADDLE_W;
		ctx.fillStyle = COLORS[s];
		ctx.beginPath();
		ctx.roundRect(x, v.paddles[s] - PADDLE_H / 2, PADDLE_W, PADDLE_H, 4);
		ctx.fill();
	}

	if (v.side !== null) {
		ctx.font = "bold 14px system-ui, sans-serif";
		ctx.fillStyle = COLORS[v.side];
		ctx.fillText("YOU", v.side === 0 ? WIDTH / 4 : (WIDTH * 3) / 4, HEIGHT - 16);
	}

	if (v.showBall) {
		ctx.fillStyle = "#f9fafb";
		ctx.beginPath();
		ctx.arc(v.ball.x, v.ball.y, BALL_R, 0, Math.PI * 2);
		ctx.fill();
	}
}
