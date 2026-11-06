// src/App.tsx

import { Suspense, useEffect, useState } from "react";
import Landing from "./Landing";
import { games } from "./games";
import { utils } from "./utils";
import "./App.css";

// Hash routing ("#/tetris") needs no server config and works with the SPA fallback.
function useHashRoute() {
	const read = () => window.location.hash.replace(/^#\/?/, "");
	const [route, setRoute] = useState(read);
	useEffect(() => {
		const onChange = () => setRoute(read());
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return route;
}

function App() {
	const route = useHashRoute();
	// "pong/ABCD" -> game "pong" with param "ABCD" (e.g. a room code).
	const [id, ...rest] = route.split("/");
	const param = rest.join("/") || undefined;
	// Games and utilities share one namespace; "utils" is the Utils tab itself.
	const game = games.find((g) => g.id === id) ?? utils.find((u) => u.id === id);

	if (!game) return <Landing tab={id === "utils" ? "utils" : "games"} />;

	const Game = game.component;
	const isUtil = utils.some((u) => u.id === id);
	return (
		<div className="game-shell">
			<a className="back-link" href={isUtil ? "#/utils" : "#/"}>
				{isUtil ? "← All utilities" : "← All games"}
			</a>
			<Suspense fallback={<p className="loading">Loading…</p>}>
				<Game param={param} />
			</Suspense>
		</div>
	);
}

export default App;
