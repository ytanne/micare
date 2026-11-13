// Pure data. Sizes and distances are compressed so everything is visible;
// orbital periods are real (Earth years).
export interface Body {
	name: string;
	radius: number; // scene units
	distance: number; // orbit radius, scene units
	period: number; // Earth years
	color: number;
	tilt?: number; // axial tilt, radians
	ring?: { inner: number; outer: number; color: number };
}

export const SUN = { name: "Sun", radius: 6, color: 0xffcc66 };

export const PLANETS: Body[] = [
	{ name: "Mercury", radius: 0.5, distance: 11, period: 0.241, color: 0x9a9a9a },
	{ name: "Venus", radius: 0.9, distance: 15, period: 0.615, color: 0xe3b778 },
	{ name: "Earth", radius: 1, distance: 20, period: 1, color: 0x3b7bd8, tilt: 0.41 },
	{ name: "Mars", radius: 0.7, distance: 25, period: 1.881, color: 0xc1502e },
	{ name: "Jupiter", radius: 2.8, distance: 36, period: 11.86, color: 0xd2a679 },
	{
		name: "Saturn",
		radius: 2.4,
		distance: 47,
		period: 29.46,
		color: 0xe6d29a,
		tilt: 0.47,
		ring: { inner: 3.2, outer: 5.2, color: 0xcdb98a },
	},
	{ name: "Uranus", radius: 1.6, distance: 57, period: 84, color: 0x8fd6df, tilt: 1.7 },
	{ name: "Neptune", radius: 1.5, distance: 66, period: 164.8, color: 0x4466e0 },
];
