# CLAUDE.md

Personal playground for AI-agentic development: browser games (Tetris, Star Defender, Pong Duel) and utilities (EPUB viewer/editor, EPUB→AZW, MP3 editor). React 19 + Vite 7 frontend, Hono worker, Cloudflare Workers. No test runner.

## Commands
- `npm run dev` / `build` / `lint`
- `npm run check`: full pre-deploy validation (tsc + build + wrangler dry-run)
- `npm run cf-typegen`: run after any `wrangler.json` binding change (regenerates `Env`)

## Architecture
- Two TS projects: `src/react-app` (browser) and `src/worker` (Workers). Don't cross-import environment APIs. `src/shared` is used by both: no DOM, no Workers APIs.
- Routing: custom hash router in `App.tsx` (`#/tetris`). First segment matches `games[].id` in `games.ts` or `utils[].id` in `utils.ts` (one shared namespace; `utils` is the Utils tab itself); the rest is the `param` prop. No match renders `Landing`.
- Add a game: create `src/react-app/<game>/`, then add an entry (`id`, `title`, `description`, `emoji`, `lazy()` component) to `games.ts`.
- Add a utility: create `src/react-app/<util>/`, add an entry to `utils.ts`. Use the shared `FileDrop` component (`src/react-app/FileDrop.tsx`) for file input, not a raw `<input type="file">`.
- Keep game logic DOM/React-free (`logic.ts` / `engine.ts`); UI and canvas rendering live in separate files.
- Shooter world is fixed 480x800 (`W`x`H` in `shooter/engine.ts`).

## Pong Duel (multiplayer)
- `src/worker/PongRoom.ts`: Durable Object `PONG_ROOM`, one per 4-char room code, max 2 sockets, authoritative 60 Hz loop only during a match. Must be re-exported from `src/worker/index.ts`. Uses `ws.accept()`, not hibernation.
- `src/shared/pong.ts`: physics, `project` extrapolation, message types. Clients send only paddle input; server snapshots at ~30 Hz; client predicts its own paddle.
- Clients ping every 5 s; seats silent for 15 s are dropped. Client opens its socket one tick late so StrictMode's throwaway mount doesn't take a seat.

## MP3 editor (`src/react-app/mp3/`)
- Fully client-side. `edit.ts` is pure (no DOM/Web Audio): samples are **Int16** (`Pcm`), edits return new snapshots, `History` caps undo depth to bound memory. `encode.ts` does MP3 (`@breezystack/lamejs`, not `lamejs`, which breaks under Vite) and WAV export in chunks.
- Built for 30-minute files: never create a full-length `AudioBuffer` or `Float32Array` copy. Playback streams 1 s chunks from the current snapshot (`pump` in `Mp3Editor.tsx`); waveform peaks are cached per snapshot (`cachedPeaks`); `floatToInt16InPlace` avoids a second allocation on load; don't resize the canvas every frame. Pause = `AudioContext.suspend()`.
- The volume slider is a *pending* gain previewed live through a `GainNode`; "Apply" bakes it into the audio.
