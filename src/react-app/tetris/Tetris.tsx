import { useEffect, useMemo, useReducer } from "react";
import {
	COLORS,
	type Action,
	type Cell,
	dropInterval,
	ghostY,
	newGame,
	previewMatrix,
	reducer,
} from "./logic";
import "./Tetris.css";

const KEY_ACTIONS: Record<string, Action["type"]> = {
	ArrowLeft: "left",
	ArrowRight: "right",
	ArrowUp: "rotate",
	x: "rotate",
	X: "rotate",
	ArrowDown: "softDrop",
	" ": "hardDrop",
	p: "pause",
	P: "pause",
	r: "restart",
	R: "restart",
};

function Tetris() {
	const [state, dispatch] = useReducer(reducer, undefined, newGame);
	const { board, piece, queue, score, lines, level, paused, gameOver } = state;

	useEffect(() => {
		if (paused || gameOver) return;
		const id = setInterval(() => dispatch({ type: "tick" }), dropInterval(level));
		return () => clearInterval(id);
	}, [level, paused, gameOver]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const type = KEY_ACTIONS[e.key];
			if (!type) return;
			e.preventDefault();
			dispatch({ type });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Board with the ghost and active piece drawn on top.
	const cells = useMemo(() => {
		const grid: { color: Cell; ghost: boolean }[][] = board.map((row) =>
			row.map((color) => ({ color, ghost: false })),
		);
		const gy = ghostY(state);
		const color = COLORS[piece.type];
		piece.matrix.forEach((row, r) =>
			row.forEach((v, c) => {
				if (!v) return;
				const x = piece.x + c;
				if (gy + r >= 0 && !grid[gy + r][x].color) {
					grid[gy + r][x] = { color, ghost: true };
				}
				if (piece.y + r >= 0) grid[piece.y + r][x] = { color, ghost: false };
			}),
		);
		return grid;
	}, [state, board, piece]);

	const next = queue[0];

	return (
		<div className="tetris">
			<div className="board">
				{cells.flat().map((cell, i) => (
					<div
						key={i}
						className={`cell${cell.color ? " filled" : ""}${cell.ghost ? " ghost" : ""}`}
						style={cell.color ? { "--c": cell.color } as React.CSSProperties : undefined}
					/>
				))}
				{(paused || gameOver) && (
					<div className="overlay">
						<h2>{gameOver ? "Game Over" : "Paused"}</h2>
						<button onClick={() => dispatch({ type: gameOver ? "restart" : "pause" })}>
							{gameOver ? "Play again" : "Resume"}
						</button>
					</div>
				)}
			</div>

			<aside className="panel">
				<h1>Tetris</h1>
				<section>
					<h3>Next</h3>
					<div className="preview">
						{previewMatrix(next).map((row, r) => (
							<div key={r} className="preview-row">
								{row.map((v, c) => (
									<div
										key={c}
										className={v ? "cell filled" : "cell"}
										style={v ? { "--c": COLORS[next] } as React.CSSProperties : undefined}
									/>
								))}
							</div>
						))}
					</div>
				</section>
				<dl className="stats">
					<dt>Score</dt>
					<dd>{score}</dd>
					<dt>Lines</dt>
					<dd>{lines}</dd>
					<dt>Level</dt>
					<dd>{level}</dd>
				</dl>
				<ul className="help">
					<li>← → move</li>
					<li>↑ / X rotate</li>
					<li>↓ soft drop</li>
					<li>Space hard drop</li>
					<li>P pause · R restart</li>
				</ul>
			</aside>

			<div className="touch">
				<button onClick={() => dispatch({ type: "left" })} aria-label="Move left">←</button>
				<button onClick={() => dispatch({ type: "rotate" })} aria-label="Rotate">⟳</button>
				<button onClick={() => dispatch({ type: "right" })} aria-label="Move right">→</button>
				<button onClick={() => dispatch({ type: "softDrop" })} aria-label="Soft drop">↓</button>
				<button onClick={() => dispatch({ type: "hardDrop" })} aria-label="Hard drop">⤓</button>
				<button onClick={() => dispatch({ type: "pause" })} aria-label="Pause">⏸</button>
			</div>
		</div>
	);
}

export default Tetris;
