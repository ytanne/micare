import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface ExperimentProps {
	param?: string;
}

export interface Experiment {
	id: string;
	title: string;
	description: string;
	emoji: string;
	component: LazyExoticComponent<ComponentType<ExperimentProps>>;
}

// To add an experiment: create its component, then add an entry here.
// Its id must not collide with a game/util id or "experiments" (the tab route).
export const experiments: Experiment[] = [
	{
		id: "solar-system",
		title: "Solar System",
		description: "Fly around a 3D model of the Sun and its eight planets.",
		emoji: "🪐",
		component: lazy(() => import("./solar-system/SolarSystem")),
	},
];
