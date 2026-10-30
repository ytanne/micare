// Pure game logic for the space shooter. No DOM access: the React component
// feeds it input and time, and render.ts draws the resulting state.

export const W = 480;
export const H = 800;
export const MAX_LEVEL = 3;

export type Phase = "menu" | "playing" | "levelComplete" | "gameOver" | "victory";
export type EnemyKind = "diver" | "zigzag" | "shooter" | "minion";
export type PickupKind = "double" | "life";
export type GameEvent =
	| "shoot"
	| "explode"
	| "hit"
	| "bossHit"
	| "pickup"
	| "levelComplete"
	| "victory"
	| "gameOver";

interface Body {
	x: number;
	y: number;
	hw: number; // half width
	hh: number; // half height
}

export interface Bullet extends Body {
	vx: number;
	vy: number;
}

export interface Enemy extends Body {
	kind: EnemyKind;
	hp: number;
	t: number;
	baseX: number;
	speed: number;
	fireCd: number;
}

export interface Boss extends Body {
	hp: number;
	maxHp: number;
	t: number;
	dir: number;
	fireCd: number;
	spawnCd: number;
	spin: number;
	entered: boolean;
	dying: number; // >0 while the death animation plays
}

export interface Pickup extends Body {
	kind: PickupKind;
}

export interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	size: number;
	color: string;
}

export interface Star {
	x: number;
	y: number;
	z: number;
}

export interface Player extends Body {
	lives: number;
	invuln: number;
	fireCd: number;
	doubleShot: number; // seconds of double shot left
}

export interface Input {
	left: boolean;
	right: boolean;
	up: boolean;
	down: boolean;
	// Touch / mouse drag target in logical coordinates, null when not dragging.
	target: { x: number; y: number } | null;
}

export interface Game {
	phase: Phase;
	level: number;
	score: number;
	best: number;
	levelTime: number;
	spawnCd: number;
	completeTimer: number;
	player: Player;
	bullets: Bullet[];
	enemyBullets: Bullet[];
	enemies: Enemy[];
	pickups: Pickup[];
	particles: Particle[];
	stars: Star[];
	boss: Boss | null;
	events: GameEvent[];
	godMode: boolean;
}

interface LevelConfig {
	duration: number; // seconds of alien waves before the boss arrives
	spawnEvery: number;
	enemyFireEvery: number;
	enemySpeed: number;
	bossHp: number;
	bossSpeed: number;
	bossFireEvery: number;
	bossMinions: number;
	bossMinionEvery: number;
}

const LEVELS: LevelConfig[] = [
	{ duration: 40, spawnEvery: 1.1, enemyFireEvery: 2.4, enemySpeed: 130, bossHp: 60, bossSpeed: 90, bossFireEvery: 1.1, bossMinions: 2, bossMinionEvery: 6 },
	{ duration: 48, spawnEvery: 0.9, enemyFireEvery: 2.0, enemySpeed: 160, bossHp: 110, bossSpeed: 130, bossFireEvery: 0.95, bossMinions: 3, bossMinionEvery: 5 },
	{ duration: 56, spawnEvery: 0.75, enemyFireEvery: 1.6, enemySpeed: 190, bossHp: 180, bossSpeed: 170, bossFireEvery: 0.8, bossMinions: 4, bossMinionEvery: 4 },
];

export const levelConfig = (level: number) => LEVELS[level - 1];

const PLAYER_SPEED = 420;
const FIRE_EVERY = 0.18;
const BOSS_Y = 140;
const COMPLETE_DELAY = 3.5;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function loadBest(): number {
	try {
		return Number(localStorage.getItem("shooter-best")) || 0;
	} catch {
		return 0;
	}
}

function saveBest(n: number) {
	try {
		localStorage.setItem("shooter-best", String(n));
	} catch {
		/* storage unavailable */
	}
}

function makePlayer(): Player {
	return { x: W / 2, y: H - 110, hw: 18, hh: 20, lives: 3, invuln: 0, fireCd: 0, doubleShot: 0 };
}

export function createGame(): Game {
	return {
		phase: "menu",
		level: 1,
		score: 0,
		best: loadBest(),
		levelTime: 0,
		spawnCd: 1,
		completeTimer: 0,
		player: makePlayer(),
		bullets: [],
		enemyBullets: [],
		enemies: [],
		pickups: [],
		particles: [],
		stars: Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1) })),
		boss: null,
		events: [],
		godMode: false,
	};
}

function resetLevel(s: Game, level: number) {
	s.level = level;
	s.levelTime = 0;
	s.spawnCd = 1;
	s.boss = null;
	s.bullets = [];
	s.enemyBullets = [];
	s.enemies = [];
	s.pickups = [];
	s.completeTimer = 0;
	s.player.x = W / 2;
	s.player.y = H - 110;
	s.player.invuln = 1.5;
	s.phase = "playing";
}

export function startGame(s: Game) {
	s.score = 0;
	s.player = makePlayer();
	s.particles = [];
	resetLevel(s, 1);
}

export function nextLevel(s: Game) {
	if (s.phase === "levelComplete") resetLevel(s, s.level + 1);
}

// Debug helpers: jump straight to the boss, or kill it.
export function skipToBoss(s: Game) {
	if (s.phase === "playing" && !s.boss) s.levelTime = levelConfig(s.level).duration;
}

export function damageBoss(s: Game, amount: number) {
	if (s.boss && s.boss.dying === 0) hitBoss(s, amount);
}

function burst(s: Game, x: number, y: number, count: number, color: string, speed = 180) {
	for (let i = 0; i < count; i++) {
		const a = rand(0, Math.PI * 2);
		const v = rand(speed * 0.2, speed);
		const life = rand(0.3, 0.8);
		s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, maxLife: life, size: rand(1.5, 4), color });
	}
}

const overlap = (a: Body, b: Body) =>
	Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;

function spawnEnemy(s: Game, cfg: LevelConfig) {
	const roll = Math.random();
	const x = rand(40, W - 40);
	const kind: EnemyKind =
		roll < 0.45 ? "diver" : roll < 0.8 || s.level === 1 && roll < 0.9 ? "zigzag" : "shooter";
	const hp = kind === "diver" ? 1 : kind === "zigzag" ? 2 : 3 + (s.level > 2 ? 1 : 0);
	s.enemies.push({
		kind,
		x,
		y: -30,
		baseX: x,
		hw: 18,
		hh: 16,
		hp,
		t: 0,
		speed: cfg.enemySpeed * (kind === "shooter" ? 0.7 : 1) * rand(0.85, 1.15),
		fireCd: rand(0.6, cfg.enemyFireEvery),
	});
}

function spawnMinions(s: Game, count: number, speed: number) {
	const boss = s.boss!;
	for (let i = 0; i < count; i++) {
		const x = boss.x + (i - (count - 1) / 2) * 50;
		s.enemies.push({
			kind: "minion",
			x,
			y: boss.y + 40,
			baseX: x,
			hw: 13,
			hh: 12,
			hp: 1,
			t: rand(0, 3),
			speed: speed * 0.9,
			fireCd: 99,
		});
	}
}

function enemyShot(s: Game, x: number, y: number, angle: number, speed: number) {
	s.enemyBullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, hw: 4, hh: 6 });
}

function aimAt(from: Body, to: Body) {
	return Math.atan2(to.y - from.y, to.x - from.x);
}

function killEnemy(s: Game, e: Enemy) {
	burst(s, e.x, e.y, 14, e.kind === "shooter" ? "#f472b6" : "#a3e635");
	s.events.push("explode");
	s.score += e.kind === "shooter" ? 30 : e.kind === "zigzag" ? 20 : 10;
	if (Math.random() < 0.1) {
		s.pickups.push({ kind: Math.random() < 0.3 ? "life" : "double", x: e.x, y: e.y, hw: 14, hh: 14 });
	}
}

function hitBoss(s: Game, amount: number) {
	const boss = s.boss!;
	boss.hp -= amount;
	s.events.push("bossHit");
	if (boss.hp > 0) return;
	boss.hp = 0;
	boss.dying = 0.01;
	s.enemyBullets = [];
	s.score += 500 * s.level;
	for (const e of s.enemies) {
		burst(s, e.x, e.y, 10, "#a3e635");
	}
	s.enemies = [];
}

function bossAttack(s: Game, cfg: LevelConfig) {
	const b = s.boss!;
	const p = s.player;
	const enraged = s.level === MAX_LEVEL && b.hp < b.maxHp * 0.3;
	const shotSpeed = 230 + s.level * 30;
	b.fireCd = cfg.bossFireEvery * (enraged ? 0.6 : 1);
	const down = Math.PI / 2;
	if (s.level === 1) {
		enemyShot(s, b.x, b.y + b.hh, aimAt(b, p), shotSpeed);
	} else if (s.level === 2) {
		const spread = [-0.35, 0, 0.35];
		for (const d of spread) enemyShot(s, b.x, b.y + b.hh, down + d, shotSpeed);
		if (Math.random() < 0.5) enemyShot(s, b.x, b.y + b.hh, aimAt(b, p), shotSpeed + 40);
	} else {
		for (const d of [-0.4, 0, 0.4]) enemyShot(s, b.x, b.y + b.hh, down + d, shotSpeed);
		b.spin += 0.35;
		const arms = enraged ? 10 : 7;
		for (let i = 0; i < arms; i++) {
			enemyShot(s, b.x, b.y, b.spin + (i / arms) * Math.PI * 2, shotSpeed - 40);
		}
	}
}

function playerShoot(s: Game) {
	const p = s.player;
	p.fireCd = FIRE_EVERY;
	const offsets = p.doubleShot > 0 ? [-10, 10] : [0];
	for (const dx of offsets) {
		s.bullets.push({ x: p.x + dx, y: p.y - 22, vx: 0, vy: -720, hw: 3, hh: 10 });
	}
	s.events.push("shoot");
}

function hurtPlayer(s: Game) {
	const p = s.player;
	if (p.invuln > 0 || s.godMode) return;
	p.lives -= 1;
	p.invuln = 2;
	p.doubleShot = 0;
	burst(s, p.x, p.y, 24, "#38bdf8", 240);
	s.events.push("hit");
	if (p.lives <= 0) {
		s.phase = "gameOver";
		s.events.push("gameOver");
		finishRun(s);
	}
}

function finishRun(s: Game) {
	if (s.score > s.best) {
		s.best = s.score;
		saveBest(s.best);
	}
}

export function update(s: Game, dt: number, input: Input) {
	dt = Math.min(dt, 0.05);

	// Background and particles keep moving on every screen.
	for (const st of s.stars) {
		st.y += (30 + st.z * 120) * dt;
		if (st.y > H) {
			st.y = 0;
			st.x = rand(0, W);
		}
	}
	for (const pt of s.particles) {
		pt.x += pt.vx * dt;
		pt.y += pt.vy * dt;
		pt.life -= dt;
	}
	s.particles = s.particles.filter((pt) => pt.life > 0);

	if (s.phase === "levelComplete") {
		s.completeTimer -= dt;
		if (s.completeTimer <= 0) nextLevel(s);
		return;
	}
	if (s.phase !== "playing") return;

	const cfg = levelConfig(s.level);
	const p = s.player;

	// --- Player movement ---
	if (input.target) {
		const dx = input.target.x - p.x;
		const dy = input.target.y - p.y;
		const k = Math.min(1, dt * 18);
		p.x += dx * k;
		p.y += dy * k;
	} else {
		const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
		const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
		const len = Math.hypot(ax, ay) || 1;
		p.x += (ax / len) * PLAYER_SPEED * dt;
		p.y += (ay / len) * PLAYER_SPEED * dt;
	}
	p.x = Math.max(p.hw, Math.min(W - p.hw, p.x));
	p.y = Math.max(H * 0.35, Math.min(H - p.hh - 10, p.y));
	p.invuln = Math.max(0, p.invuln - dt);
	p.doubleShot = Math.max(0, p.doubleShot - dt);
	p.fireCd -= dt;
	if (p.fireCd <= 0) playerShoot(s);

	// --- Level flow ---
	s.levelTime += dt;
	if (s.levelTime < cfg.duration) {
		s.spawnCd -= dt;
		if (s.spawnCd <= 0) {
			s.spawnCd = cfg.spawnEvery * rand(0.7, 1.3);
			spawnEnemy(s, cfg);
		}
	} else if (!s.boss && (s.enemies.length === 0 || s.levelTime > cfg.duration + 5)) {
		s.boss = {
			x: W / 2,
			y: -90,
			hw: 70 + s.level * 6,
			hh: 44 + s.level * 4,
			hp: cfg.bossHp,
			maxHp: cfg.bossHp,
			t: 0,
			dir: 1,
			fireCd: 1.5,
			spawnCd: cfg.bossMinionEvery * 0.6,
			spin: 0,
			entered: false,
			dying: 0,
		};
	}

	// --- Boss ---
	const boss = s.boss;
	if (boss) {
		if (boss.dying > 0) {
			boss.dying += dt;
			if (Math.random() < 0.5) {
				burst(s, boss.x + rand(-boss.hw, boss.hw), boss.y + rand(-boss.hh, boss.hh), 8, "#fbbf24", 220);
				s.events.push("explode");
			}
			if (boss.dying > 2) {
				burst(s, boss.x, boss.y, 80, "#fde68a", 320);
				s.boss = null;
				s.bullets = [];
				if (s.level >= MAX_LEVEL) {
					s.phase = "victory";
					s.events.push("victory");
					finishRun(s);
				} else {
					s.phase = "levelComplete";
					s.completeTimer = COMPLETE_DELAY;
					s.events.push("levelComplete");
					finishRun(s);
				}
				return;
			}
		} else if (!boss.entered) {
			boss.y += 80 * dt;
			if (boss.y >= BOSS_Y) boss.entered = true;
		} else {
			boss.t += dt;
			const enraged = s.level === MAX_LEVEL && boss.hp < boss.maxHp * 0.3;
			boss.x += boss.dir * cfg.bossSpeed * (enraged ? 1.3 : 1) * dt;
			if (boss.x > W - boss.hw) boss.dir = -1;
			if (boss.x < boss.hw) boss.dir = 1;
			boss.y = BOSS_Y + Math.sin(boss.t * 1.3) * 20;
			boss.fireCd -= dt;
			if (boss.fireCd <= 0) bossAttack(s, cfg);
			boss.spawnCd -= dt;
			if (boss.spawnCd <= 0) {
				boss.spawnCd = cfg.bossMinionEvery;
				spawnMinions(s, cfg.bossMinions, cfg.enemySpeed);
			}
		}
	}

	// --- Player bullets ---
	for (const b of s.bullets) {
		b.x += b.vx * dt;
		b.y += b.vy * dt;
	}
	for (const b of s.bullets) {
		if (b.y < -20) b.hh = 0;
	}
	for (const b of s.bullets) {
		if (b.hh === 0) continue;
		const target = s.enemies.find((e) => e.hp > 0 && overlap(b, e));
		if (target) {
			target.hp -= 1;
			b.hh = 0;
			if (target.hp <= 0) killEnemy(s, target);
			else burst(s, b.x, b.y, 3, "#fde68a", 90);
			continue;
		}
		if (s.boss && s.boss.dying === 0 && overlap(b, s.boss)) {
			b.hh = 0;
			burst(s, b.x, b.y, 3, "#fde68a", 90);
			hitBoss(s, 1);
		}
	}
	s.bullets = s.bullets.filter((b) => b.hh > 0);

	// --- Enemies ---
	for (const e of s.enemies) {
		e.t += dt;
		if (e.kind === "diver") {
			e.y += e.speed * dt;
		} else if (e.kind === "zigzag" || e.kind === "minion") {
			e.y += e.speed * 0.8 * dt;
			e.x = e.baseX + Math.sin(e.t * 3) * 70;
		} else {
			// Shooters slide down to a hover line, strafe, and fire aimed shots.
			if (e.y < 120 + (e.baseX % 100) || e.t > 9) e.y += e.speed * dt; // leaves after a while
			e.x = e.baseX + Math.sin(e.t * 1.5) * 50;
			e.fireCd -= dt;
			if (e.fireCd <= 0) {
				e.fireCd = cfg.enemyFireEvery;
				enemyShot(s, e.x, e.y + 14, aimAt(e, p), 200 + s.level * 25);
			}
		}
		e.x = Math.max(e.hw, Math.min(W - e.hw, e.x));
		if (e.kind === "zigzag" && e.t > 0.8 && e.fireCd < 90) {
			e.fireCd -= dt;
			if (e.fireCd <= 0 && s.level > 1) {
				e.fireCd = cfg.enemyFireEvery * 1.5;
				enemyShot(s, e.x, e.y + 14, Math.PI / 2, 220);
			}
		}
		if (e.hp > 0 && overlap(e, p)) {
			e.hp = 0;
			killEnemy(s, e);
			hurtPlayer(s);
		}
	}
	s.enemies = s.enemies.filter((e) => e.hp > 0 && e.y < H + 40);

	// --- Boss touching the player ---
	if (s.boss && s.boss.dying === 0 && overlap(s.boss, p)) hurtPlayer(s);

	// --- Enemy bullets ---
	for (const b of s.enemyBullets) {
		b.x += b.vx * dt;
		b.y += b.vy * dt;
	}
	for (const b of s.enemyBullets) {
		if (overlap(b, { x: p.x, y: p.y, hw: p.hw - 4, hh: p.hh - 4 })) {
			b.hh = 0;
			hurtPlayer(s);
		}
	}
	s.enemyBullets = s.enemyBullets.filter(
		(b) => b.hh > 0 && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20,
	);

	// --- Pickups ---
	for (const pk of s.pickups) {
		pk.y += 90 * dt;
		if (overlap(pk, p)) {
			pk.y = H + 100;
			s.events.push("pickup");
			if (pk.kind === "life") p.lives = Math.min(5, p.lives + 1);
			else p.doubleShot = 12;
		}
	}
	s.pickups = s.pickups.filter((pk) => pk.y < H + 30);
}
