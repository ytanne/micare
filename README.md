# Micare

A personal playground for exercising **AI agentic development**. Instead of a single product, Micare is a growing collection of small tools and games that I build with AI coding agents whenever I need something: the app is both the practice ground and the result.

## What's inside

- **Games** — Tetris, Star Defender (a shooter) and Pong Duel (live two-player matches over WebSockets).
- **Utilities** — EPUB viewer/editor, EPUB → AZW converter, and an in-browser MP3 editor (trim, cut, volume, fades, MP3/WAV export). Files are processed locally in the browser.

## Stack

React 19 + TypeScript + Vite on the front end, a Hono worker on the back end, deployed to Cloudflare Workers (Pong Duel rooms use a Durable Object).

## Development

```bash
npm install
npm run dev     # local dev server
npm run lint
npm run check   # tsc + build + wrangler dry-run
npm run deploy  # deploy to Cloudflare Workers
```

See [`CLAUDE.md`](./CLAUDE.md) for architecture notes and how to add a new game.
