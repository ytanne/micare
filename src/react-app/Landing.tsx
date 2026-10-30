import { games } from "./games";

function Landing() {
	return (
		<main className="landing">
			<h1>Pick a game</h1>
			<div className="game-grid">
				{games.map((game) => (
					<a key={game.id} className="game-card" href={`#/${game.id}`}>
						<span className="game-emoji" aria-hidden="true">
							{game.emoji}
						</span>
						<h2>{game.title}</h2>
						<p>{game.description}</p>
					</a>
				))}
			</div>
		</main>
	);
}

export default Landing;
