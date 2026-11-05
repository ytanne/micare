import {
	useEffect,
	useMemo,
	useReducer,
	useRef,
	type Dispatch,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	COLORS,
	COLS,
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

interface Gesture {
	x: number;
	y: number;
	anchorX: number;
	anchorY: number;
	time: number;
	moved: boolean;
}

// Touch gestures on the board: tap rotates, drag moves/soft-drops, flick down hard-drops.
function useBoardGestures(dispatch: Dispatch<Action>) {
	const gesture = useRef<Gesture | null>(null);

	return {
		onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
			if (e.pointerType !== "touch") return;
			if ((e.target as HTMLElement).closest(".overlay")) return;
			e.currentTarget.setPointerCapture(e.pointerId);
			gesture.current = {
				x: e.clientX,
				y: e.clientY,
				anchorX: e.clientX,
				anchorY: e.clientY,
				time: performance.now(),
				moved: false,
			};
		},
		onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
			const g = gesture.current;
			if (!g) return;
			const size = e.currentTarget.getBoundingClientRect().width / COLS;
			while (e.clientX - g.anchorX >= size) {
				dispatch({ type: "right" });
				g.anchorX += size;
			}
			while (g.anchorX - e.clientX >= size) {
				dispatch({ type: "left" });
				g.anchorX -= size;
			}
			while (e.clientY - g.anchorY >= size) {
				dispatch({ type: "softDrop" });
				g.anchorY += size;
			}
			if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) g.moved = true;
		},
		onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
			const g = gesture.current;
			gesture.current = null;
			if (!g) return;
			const elapsed = performance.now() - g.time;
			const dx = e.clientX - g.x;
			const dy = e.clientY - g.y;
			if (!g.moved && elapsed < 300) dispatch({ type: "rotate" });
			else if (dy > 60 && dy > Math.abs(dx) && dy / elapsed > 0.8) {
				dispatch({ type: "hardDrop" });
			}
		},
		onPointerCancel() {
			gesture.current = null;
		},
	};
}

function Tetris() {
	const [state, dispatch] = useReducer(reducer, undefined, newGame);
	const { board, piece, queue, score, lines, level, paused, gameOver } = state;
	const gestures = useBoardGestures(dispatch);

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

	// Pause when the tab or app goes to the background (e.g. switching apps on a phone).
	useEffect(() => {
		const onVisibility = () => {
			if (document.hidden) dispatch({ type: "blur" });
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
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
	// Drop empty rows so the preview stays compact (the I piece is a 4x4 matrix).
	const nextRows = previewMatrix(next).filter((row) => row.some(Boolean));

	return (
		<div className="tetris">
			<div className="board" {...gestures}>
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
						{nextRows.map((row, r) => (
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
				<button
					className="pause-btn"
					aria-label={paused ? "Resume" : "Pause"}
					onClick={() => dispatch({ type: "pause" })}
					disabled={gameOver}
				>
					{paused ? "▶" : "⏸"}
				</button>
				<ul className="help">
					<li>← → move</li>
					<li>↑ / X rotate</li>
					<li>↓ soft drop</li>
					<li>Space hard drop</li>
					<li>P pause · R restart</li>
				</ul>
			</aside>

			<p className="hint">Tap to rotate · swipe to move · flick down to drop</p>
		</div>
	);
}

export default Tetris;
