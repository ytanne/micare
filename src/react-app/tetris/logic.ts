export const COLS = 10;
export const ROWS = 20;

export type Cell = string | null;
export type Board = Cell[][];
export type Matrix = number[][];

export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

export interface Piece {
	type: PieceType;
	matrix: Matrix;
	x: number;
	y: number;
}

export const COLORS: Record<PieceType, string> = {
	I: "#22d3ee",
	O: "#facc15",
	T: "#a855f7",
	S: "#22c55e",
	Z: "#ef4444",
	J: "#3b82f6",
	L: "#f97316",
};

const SHAPES: Record<PieceType, Matrix> = {
	I: [
		[0, 0, 0, 0],
		[1, 1, 1, 1],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
	],
	O: [
		[1, 1],
		[1, 1],
	],
	T: [
		[0, 1, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	S: [
		[0, 1, 1],
		[1, 1, 0],
		[0, 0, 0],
	],
	Z: [
		[1, 1, 0],
		[0, 1, 1],
		[0, 0, 0],
	],
	J: [
		[1, 0, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	L: [
		[0, 0, 1],
		[1, 1, 1],
		[0, 0, 0],
	],
};

const TYPES = Object.keys(SHAPES) as PieceType[];
const LINE_SCORES = [0, 100, 300, 500, 800];

export interface GameState {
	board: Board;
	piece: Piece;
	queue: PieceType[];
	score: number;
	lines: number;
	level: number;
	paused: boolean;
	gameOver: boolean;
}

export function emptyBoard(): Board {
	return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

// 7-bag randomizer: every piece appears once per bag of seven.
function newBag(): PieceType[] {
	const bag = [...TYPES];
	for (let i = bag.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[bag[i], bag[j]] = [bag[j], bag[i]];
	}
	return bag;
}

function spawn(type: PieceType): Piece {
	const matrix = SHAPES[type].map((row) => [...row]);
	return {
		type,
		matrix,
		x: Math.floor((COLS - matrix[0].length) / 2),
		y: type === "I" ? -1 : 0,
	};
}

export function rotate(matrix: Matrix): Matrix {
	const n = matrix.length;
	return matrix.map((_, r) => matrix.map((_, c) => matrix[n - 1 - c][r]));
}

export function collides(
	board: Board,
	matrix: Matrix,
	x: number,
	y: number,
): boolean {
	for (let r = 0; r < matrix.length; r++) {
		for (let c = 0; c < matrix[r].length; c++) {
			if (!matrix[r][c]) continue;
			const bx = x + c;
			const by = y + r;
			if (bx < 0 || bx >= COLS || by >= ROWS) return true;
			if (by >= 0 && board[by][bx]) return true;
		}
	}
	return false;
}

function merge(board: Board, piece: Piece): Board {
	const next = board.map((row) => [...row]);
	piece.matrix.forEach((row, r) =>
		row.forEach((v, c) => {
			const by = piece.y + r;
			if (v && by >= 0) next[by][piece.x + c] = COLORS[piece.type];
		}),
	);
	return next;
}

function clearLines(board: Board): { board: Board; cleared: number } {
	const kept = board.filter((row) => row.some((cell) => !cell));
	const cleared = ROWS - kept.length;
	const fresh = Array.from({ length: cleared }, () =>
		Array<Cell>(COLS).fill(null),
	);
	return { board: [...fresh, ...kept], cleared };
}

export function dropInterval(level: number): number {
	return Math.max(100, 800 - (level - 1) * 70);
}

export function ghostY(state: GameState): number {
	const { board, piece } = state;
	let y = piece.y;
	while (!collides(board, piece.matrix, piece.x, y + 1)) y++;
	return y;
}

export function newGame(): GameState {
	const queue = [...newBag(), ...newBag()];
	return {
		board: emptyBoard(),
		piece: spawn(queue.shift()!),
		queue,
		score: 0,
		lines: 0,
		level: 1,
		paused: false,
		gameOver: false,
	};
}

// Lock the current piece, clear lines, and bring in the next piece.
function lockPiece(state: GameState, bonus = 0): GameState {
	const merged = merge(state.board, state.piece);
	const { board, cleared } = clearLines(merged);
	const lines = state.lines + cleared;
	const queue = [...state.queue];
	const piece = spawn(queue.shift()!);
	if (queue.length < 7) queue.push(...newBag());
	return {
		...state,
		board,
		piece,
		queue,
		lines,
		level: 1 + Math.floor(lines / 10),
		score: state.score + bonus + LINE_SCORES[cleared] * state.level,
		gameOver: collides(board, piece.matrix, piece.x, piece.y),
	};
}

function tryMove(state: GameState, dx: number, dy: number): GameState | null {
	const { piece, board } = state;
	if (collides(board, piece.matrix, piece.x + dx, piece.y + dy)) return null;
	return { ...state, piece: { ...piece, x: piece.x + dx, y: piece.y + dy } };
}

export type Action =
	| { type: "tick" }
	| { type: "left" }
	| { type: "right" }
	| { type: "rotate" }
	| { type: "softDrop" }
	| { type: "hardDrop" }
	| { type: "pause" }
	| { type: "restart" };

export function reducer(state: GameState, action: Action): GameState {
	if (action.type === "restart") return newGame();
	if (state.gameOver) return state;
	if (action.type === "pause") return { ...state, paused: !state.paused };
	if (state.paused) return state;

	switch (action.type) {
		case "left":
			return tryMove(state, -1, 0) ?? state;
		case "right":
			return tryMove(state, 1, 0) ?? state;
		case "tick":
			return tryMove(state, 0, 1) ?? lockPiece(state);
		case "softDrop": {
			const moved = tryMove(state, 0, 1);
			return moved ? { ...moved, score: moved.score + 1 } : lockPiece(state);
		}
		case "hardDrop": {
			const y = ghostY(state);
			const dropped = { ...state, piece: { ...state.piece, y } };
			return lockPiece(dropped, (y - state.piece.y) * 2);
		}
		case "rotate": {
			const { piece, board } = state;
			const matrix = rotate(piece.matrix);
			// Simple wall kicks: nudge sideways if the rotation is blocked.
			for (const dx of [0, -1, 1, -2, 2]) {
				if (!collides(board, matrix, piece.x + dx, piece.y)) {
					return { ...state, piece: { ...piece, matrix, x: piece.x + dx } };
				}
			}
			return state;
		}
	}
}

export function previewMatrix(type: PieceType): Matrix {
	return SHAPES[type];
}
