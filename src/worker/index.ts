import { Hono } from "hono";
export { PongRoom } from "./PongRoom";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

// WebSocket entry point: every room code maps to exactly one PongRoom instance.
app.get("/api/pong/:room", (c) => {
	if (c.req.header("Upgrade") !== "websocket") {
		return c.text("Expected a WebSocket upgrade", 426);
	}
	const room = c.req.param("room").toUpperCase();
	if (!/^[A-Z0-9]{4}$/.test(room)) return c.text("Invalid room code", 400);

	const id = c.env.PONG_ROOM.idFromName(room);
	return c.env.PONG_ROOM.get(id).fetch(c.req.raw);
});

export default app;
