// src/App.tsx

import { Suspense, useEffect, useState } from "react";
import Landing from "./Landing";
import { games } from "./games";
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
	const game = games.find((g) => g.id === route);

	if (!game) return <Landing />;

	const Game = game.component;
	return (
		<div className="game-shell">
			<a className="back-link" href="#/">
				← All games
			</a>
			<Suspense fallback={<p className="loading">Loading…</p>}>
				<Game />
			</Suspense>
		</div>
	);
}

export default App;
