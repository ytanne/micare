import { games } from "./games";
import { utils } from "./utils";

export type LandingTab = "games" | "utils";

const tabs: { id: LandingTab; label: string; href: string }[] = [
	{ id: "games", label: "Games", href: "#/" },
	{ id: "utils", label: "Utils", href: "#/utils" },
];

function Landing({ tab }: { tab: LandingTab }) {
	const items = tab === "games" ? games : utils;
	return (
		<main className="landing">
			<h1>{tab === "games" ? "Pick a game" : "Pick a utility"}</h1>
			<nav className="landing-tabs" role="tablist">
				{tabs.map((t) => (
					<a
						key={t.id}
						role="tab"
						aria-selected={t.id === tab}
						className={`landing-tab${t.id === tab ? " active" : ""}`}
						href={t.href}
					>
						{t.label}
					</a>
				))}
			</nav>
			{items.length === 0 ? (
				<p className="landing-empty">Nothing here yet — coming soon.</p>
			) : (
				<div className="game-grid">
					{items.map((item) => (
						<a key={item.id} className="game-card" href={`#/${item.id}`}>
							<span className="game-emoji" aria-hidden="true">
								{item.emoji}
							</span>
							<h2>{item.title}</h2>
							<p>{item.description}</p>
						</a>
					))}
				</div>
			)}
		</main>
	);
}

export default Landing;
