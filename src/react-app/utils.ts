import { lazy, type ComponentType, LazyExoticComponent } from "react";

export interface UtilProps {
	// Whatever follows the utility id in the URL hash.
	param?: string;
}

export interface Util {
	id: string;
	title: string;
	description: string;
	emoji: string;
	component: LazyExoticComponent<ComponentType<UtilProps>>;
}

// To add a utility: create its component, then add an entry here.
// Its id must not collide with a game id or "utils" (the tab route).
export const utils: Util[] = [
	{
		id: "epub",
		title: "EPUB Viewer / Editor",
		description: "Open an EPUB, read it, edit chapter source, and save.",
		emoji: "📖",
		component: lazy(() => import("./epub/Epub")),
	},
	{
		id: "azw",
		title: "EPUB → AZW",
		description: "Convert an EPUB to a Kindle AZW (MOBI) file.",
		emoji: "📚",
		component: lazy(() => import("./azw/Azw")),
	},
];
