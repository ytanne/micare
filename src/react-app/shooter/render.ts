import { H, W, type Boss, type Enemy, type Game, type Pickup, type Player } from "./engine";

const BOSS_COLORS = ["#ef4444", "#a855f7", "#f59e0b"];

function polygon(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
	ctx.beginPath();
	pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
	ctx.closePath();
}

function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, time: number) {
	if (p.invuln > 0 && Math.floor(time * 12) % 2 === 0) return;
	ctx.save();
	ctx.translate(p.x, p.y);
	// engine flame
	ctx.fillStyle = "#fb923c";
	const flame = 10 + Math.sin(time * 40) * 4;
	polygon(ctx, [[-6, 14], [0, 14 + flame], [6, 14]]);
	ctx.fill();
	// wings
	ctx.fillStyle = "#38bdf8";
	polygon(ctx, [[0, -22], [20, 16], [8, 12], [0, 18], [-8, 12], [-20, 16]]);
	ctx.fill();
	// cockpit
	ctx.fillStyle = "#e0f2fe";
	ctx.beginPath();
	ctx.ellipse(0, -2, 4, 8, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy) {
	ctx.save();
	ctx.translate(e.x, e.y);
	if (e.kind === "diver") {
		ctx.fillStyle = "#a3e635";
		polygon(ctx, [[0, 16], [18, -14], [0, -6], [-18, -14]]);
	} else if (e.kind === "zigzag") {
		ctx.fillStyle = "#facc15";
		polygon(ctx, [[0, 16], [18, 0], [10, -16], [-10, -16], [-18, 0]]);
	} else if (e.kind === "shooter") {
		ctx.fillStyle = "#f472b6";
		polygon(ctx, [[0, 16], [20, 4], [14, -16], [-14, -16], [-20, 4]]);
	} else {
		ctx.fillStyle = "#fb7185";
		polygon(ctx, [[0, 12], [13, -10], [-13, -10]]);
	}
	ctx.fill();
	ctx.fillStyle = "#111827";
	ctx.beginPath();
	ctx.arc(-5, -2, 2.5, 0, Math.PI * 2);
	ctx.arc(5, -2, 2.5, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawBoss(ctx: CanvasRenderingContext2D, b: Boss, level: number, time: number) {
	const color = BOSS_COLORS[level - 1];
	ctx.save();
	ctx.translate(b.x, b.y);
	if (b.dying > 0) ctx.translate(Math.sin(time * 90) * 4, 0);
	const flash = b.dying > 0 && Math.floor(time * 20) % 2 === 0;
	ctx.fillStyle = flash ? "#fff" : color;
	// hull
	polygon(ctx, [[0, b.hh], [b.hw, -b.hh * 0.2], [b.hw * 0.7, -b.hh], [-b.hw * 0.7, -b.hh], [-b.hw, -b.hh * 0.2]]);
	ctx.fill();
	// armor plating
	ctx.fillStyle = "rgba(0,0,0,0.3)";
	polygon(ctx, [[0, b.hh * 0.6], [b.hw * 0.55, -b.hh * 0.1], [-b.hw * 0.55, -b.hh * 0.1]]);
	ctx.fill();
	// cannons
	ctx.fillStyle = "#374151";
	for (let i = 0; i < level; i++) {
		const cx = (i - (level - 1) / 2) * 36;
		ctx.fillRect(cx - 5, b.hh - 6, 10, 18);
	}
	// glowing eye
	ctx.fillStyle = "#fef08a";
	ctx.shadowColor = "#fef08a";
	ctx.shadowBlur = 16;
	ctx.beginPath();
	ctx.arc(0, -b.hh * 0.3, 12 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawPickup(ctx: CanvasRenderingContext2D, pk: Pickup) {
	ctx.save();
	ctx.translate(pk.x, pk.y);
	ctx.fillStyle = pk.kind === "life" ? "#f43f5e" : "#22d3ee";
	ctx.beginPath();
	ctx.arc(0, 0, 13, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#fff";
	ctx.font = "bold 16px sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(pk.kind === "life" ? "+" : "2x", 0, 1);
	ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, s: Game) {
	ctx.fillStyle = "#e5e7eb";
	ctx.font = "bold 18px system-ui, sans-serif";
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	ctx.fillText(`Score ${s.score}`, 12, 10);
	ctx.textAlign = "right";
	ctx.fillText(`Level ${s.level}/3`, W - 12, 10);
	ctx.textAlign = "left";
	ctx.fillText("♥".repeat(Math.max(0, s.player.lives)), 12, 34);
	if (s.player.doubleShot > 0) {
		ctx.fillStyle = "#22d3ee";
		ctx.font = "bold 14px system-ui, sans-serif";
		ctx.textAlign = "right";
		ctx.fillText(`2x shot ${Math.ceil(s.player.doubleShot)}s`, W - 12, 36);
	}
	const b = s.boss;
	if (b) {
		const bw = W - 24;
		const x = 12;
		const y = 62;
		ctx.fillStyle = "rgba(0,0,0,0.6)";
		ctx.fillRect(x - 2, y - 2, bw + 4, 18);
		ctx.fillStyle = "#7f1d1d";
		ctx.fillRect(x, y, bw, 14);
		ctx.fillStyle = b.hp / b.maxHp > 0.3 ? "#ef4444" : "#f97316";
		ctx.fillRect(x, y, bw * (b.hp / b.maxHp), 14);
		ctx.fillStyle = "#fff";
		ctx.font = "bold 11px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(`BOSS  ${b.hp}/${b.maxHp}`, W / 2, y + 7);
	}
}

export function draw(ctx: CanvasRenderingContext2D, s: Game, time: number) {
	ctx.fillStyle = "#050816";
	ctx.fillRect(0, 0, W, H);

	for (const st of s.stars) {
		ctx.fillStyle = `rgba(255,255,255,${0.3 + st.z * 0.6})`;
		ctx.fillRect(st.x, st.y, st.z * 2 + 0.5, st.z * 2 + 0.5);
	}

	for (const pk of s.pickups) drawPickup(ctx, pk);
	for (const e of s.enemies) drawEnemy(ctx, e);
	if (s.boss) drawBoss(ctx, s.boss, s.level, time);

	ctx.fillStyle = "#fde047";
	for (const b of s.bullets) ctx.fillRect(b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 2);

	ctx.fillStyle = "#fb7185";
	for (const b of s.enemyBullets) {
		ctx.beginPath();
		ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
		ctx.fill();
	}

	if (s.phase === "playing" || s.phase === "levelComplete") drawPlayer(ctx, s.player, time);

	for (const pt of s.particles) {
		ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
		ctx.fillStyle = pt.color;
		ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
	}
	ctx.globalAlpha = 1;

	if (s.phase !== "menu") drawHud(ctx, s);
}
