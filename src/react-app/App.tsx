// src/App.tsx

import { Suspense, useEffect, useState } from "react";
import Landing from "./Landing";
import { games } from "./games";
import { utils } from "./utils";
import { experiments } from "./experiments";
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
	const game =
		games.find((g) => g.id === id) ??
		utils.find((u) => u.id === id) ??
		experiments.find((x) => x.id === id);

	if (!game) {
		const tab = id === "utils" || id === "experiments" ? id : "games";
		return <Landing tab={tab} />;
	}

	const Game = game.component;
	const isUtil = utils.some((u) => u.id === id);
	const isExperiment = experiments.some((x) => x.id === id);
	const [backHref, backLabel] = isExperiment
		? ["#/experiments", "← All experiments"]
		: isUtil
			? ["#/utils", "← All utilities"]
			: ["#/", "← All games"];
	return (
		<div className="game-shell">
			<a className="back-link" href={backHref}>
				{backLabel}
			</a>
			<Suspense fallback={<p className="loading">Loading…</p>}>
				<Game param={param} />
			</Suspense>
		</div>
	);
}

export default App;
