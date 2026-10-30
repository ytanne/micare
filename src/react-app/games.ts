import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface GameProps {
	// Whatever follows the game id in the URL hash, e.g. a room code.
	param?: string;
}

export interface Game {
	id: string;
	title: string;
	description: string;
	emoji: string;
	component: LazyExoticComponent<ComponentType<GameProps>>;
}

// To add a game: create its component, then add an entry here.
export const games: Game[] = [
	{
		id: "tetris",
		title: "Tetris",
		description: "Stack falling blocks and clear lines.",
		emoji: "🧱",
		component: lazy(() => import("./tetris/Tetris")),
	},
	{
		id: "shooter",
		title: "Star Defender",
		description: "Blast alien waves and beat three bosses.",
		emoji: "🚀",
		component: lazy(() => import("./shooter/Shooter")),
	},
	{
		id: "pong",
		title: "Pong Duel",
		description: "Invite a friend to a live 2-player match.",
		emoji: "🏓",
		component: lazy(() => import("./pong/Pong")),
	},
];
