# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A small browser-games site (Tetris, "Star Defender" space shooter) built from the Cloudflare `vite-react-template`: React 19 + Vite 7 frontend, Hono worker backend, deployed to Cloudflare Workers. The README is still the unmodified template README.

## Commands

```bash
npm run dev       # Vite dev server (http://localhost:5173), runs the worker via @cloudflare/vite-plugin
npm run build     # tsc -b && vite build (client output goes to dist/client)
npm run lint      # eslint .
npm run check     # tsc && vite build && wrangler deploy --dry-run (full pre-deploy validation)
npm run deploy    # wrangler deploy
npm run cf-typegen  # regenerate worker-configuration.d.ts (the `Env` type) after changing wrangler.json bindings
```

There is no test runner configured.

## Architecture

- **Two TypeScript projects**: `src/react-app` (browser, `tsconfig.app.json`) and `src/worker` (Workers runtime, `tsconfig.worker.json`). `tsconfig.json` references both plus `tsconfig.node.json`. Keep browser and worker code from importing each other's environment-specific APIs.
- **Worker** (`src/worker/index.ts`): a Hono app with a single placeholder `/api/` route. `wrangler.json` serves `dist/client` as static assets with `not_found_handling: "single-page-application"`, so unknown paths fall back to `index.html`.
- **Routing** (`App.tsx`): custom hash router (`#/tetris`), no router library. The route string is matched against `games[].id`; no match renders `Landing`.
- **Game registry** (`games.ts`): each game is an entry with `id`, `title`, `description`, `emoji`, and a `lazy()` component. Adding a game = create its component and add an entry here; Landing and routing pick it up automatically. Games are code-split via the lazy imports.
- **Game structure convention**: each game lives in `src/react-app/<game>/` and separates pure logic from the UI:
  - `tetris/logic.ts` – pure board/piece functions; `Tetris.tsx` – React UI.
  - `shooter/engine.ts` – DOM-free simulation (fixed `W`×`H` = 480×800 world; fed input and time by the component, emits `GameEvent`s); `render.ts` – canvas drawing of the engine state; `Shooter.tsx` – React component wiring input, loop, audio/events, and HUD.
  Keep game logic free of DOM/React so it stays testable.
