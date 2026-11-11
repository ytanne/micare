# CLAUDE.md

Browser-games site (Tetris, Star Defender, Pong Duel). React 19 + Vite 7 frontend, Hono worker, Cloudflare Workers. No test runner.

## Commands
- `npm run dev` / `build` / `lint`
- `npm run check`: full pre-deploy validation (tsc + build + wrangler dry-run)
- `npm run cf-typegen`: run after any `wrangler.json` binding change (regenerates `Env`)

## Architecture
- Two TS projects: `src/react-app` (browser) and `src/worker` (Workers). Don't cross-import environment APIs. `src/shared` is used by both: no DOM, no Workers APIs.
- Routing: custom hash router in `App.tsx` (`#/tetris`). First segment matches `games[].id` in `games.ts`; the rest is the game's `param` prop. No match renders `Landing`.
- Add a game: create `src/react-app/<game>/`, then add an entry (`id`, `title`, `description`, `emoji`, `lazy()` component) to `games.ts`.
- Keep game logic DOM/React-free (`logic.ts` / `engine.ts`); UI and canvas rendering live in separate files.
- Shooter world is fixed 480x800 (`W`x`H` in `shooter/engine.ts`).

## Pong Duel (multiplayer)
- `src/worker/PongRoom.ts`: Durable Object `PONG_ROOM`, one per 4-char room code, max 2 sockets, authoritative 60 Hz loop only during a match. Must be re-exported from `src/worker/index.ts`. Uses `ws.accept()`, not hibernation.
- `src/shared/pong.ts`: physics, `project` extrapolation, message types. Clients send only paddle input; server snapshots at ~30 Hz; client predicts its own paddle.
- Clients ping every 5 s; seats silent for 15 s are dropped. Client opens its socket one tick late so StrictMode's throwaway mount doesn't take a seat.
