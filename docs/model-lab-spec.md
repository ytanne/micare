# Model Lab: a local 3D model tool that Claude Code can drive

## Goal
A local app for building low-poly 3D models (spaceships, asteroids, pickups, stations).
- **Claude Code** creates and edits models by calling MCP tools, and can *see* the result via rendered screenshots.
- **You** refine the same models by hand in a web UI (select a part, drag, change colour, etc.).
- Both work on the **same model files**, and each sees the other's changes live.
- Models are plain JSON, so games can load them with a tiny `buildModel(spec)` function.

## Non-goals (v1)
Organic/high-detail modelling, UV textures, animation/rigging, a cloud service, multi-user editing.

## Architecture
One Node process (TypeScript), started with `npm run dev`:

```
Claude Code ──MCP (streamable HTTP, /mcp)──┐
                                           ├─► Model Lab server ──► models/*.json (source of truth)
Browser UI ──WebSocket + REST──────────────┘         │
                                                     └─► Playwright (headless) ──► PNG screenshots
```

- **Server:** Hono (or Express) + `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`) + `ws`.
  Port 3777: `/` UI, `/mcp` MCP endpoint, `/ws` live updates.
- **UI:** Vite + React + three.js (`OrbitControls`, `TransformControls`).
- **Storage:** `models/<name>.json`. A file watcher (chokidar) pushes external edits (git checkout, hand edits) to the UI.
- **Rendering for Claude:** server launches headless Chromium (Playwright), opens `/render?model=<name>&view=<view>` (same UI code, no chrome, fixed camera), returns a PNG. Works even if no browser UI is open.
- **Register in Claude Code:** `claude mcp add --transport http modellab http://localhost:3777/mcp`

All mutations go through one server-side function (`applyOps(model, ops)`) so MCP and UI behave identically, and every change is revision-numbered and undoable.

## Conventions (document these in the repo's CLAUDE.md)
- Units are arbitrary "scene units"; a fighter ship is roughly 4 long x 4 wide x 1 high.
- Right-handed; **-Z is forward (the nose)**, +Y up, +X right. Rotations are in **degrees**, Euler XYZ.
- Colours are hex strings. Symmetric models describe the **+X half only** and set `mirrorX: true`.
- Part ids are short stable strings (`wing_l`, `engine`), never indexes.

## Model format (`models/*.json`)
```jsonc
{
  "name": "fighter-1",
  "version": 1,
  "meta": { "forward": "-Z", "hitRadius": 1.4 },   // hitRadius: collision sphere for the game
  "mirrorX": true,
  "parts": [
    {
      "id": "hull",
      "shape": "cone",                 // box | sphere | cylinder | cone | wedge | prism
      "size": [0.6, 2.5],              // shape-specific, see below
      "pos": [0, 0, -1.5],
      "rot": [-90, 0, 0],
      "scale": [1, 1, 1],
      "color": "#c0c8d8",
      "emissive": null,                // e.g. "#66ccff" for glowing parts
      "flatShading": true,
      "mirror": false,                 // per-part override of model-level mirrorX
      "group": "body",                 // optional label for the part list
      "parent": null                   // optional part id, so children move with it
    }
  ]
}
```

Shape `size` arrays:
- `box [w,h,d]`
- `sphere [r]`
- `cylinder [rTop,rBottom,h]`
- `cone [r,h]`
- `wedge [w,h,d]` (triangular ramp, good for wings)
- `prism [r,h,sides]`

Zod schema lives in `src/shared/schema.ts` (no DOM, no Node APIs) and is used by server, UI and games.

## MCP tools
All tools return compact JSON (never huge dumps) and the new `revision`.

| Tool | Purpose |
|---|---|
| `list_models()` | Names, part counts, last modified |
| `get_model(name)` | Full JSON plus an ASCII part tree |
| `create_model(name, mirrorX?, template?)` | New model, optionally from a template (`ship`, `asteroid`, `blank`) |
| `add_part(model, part)` | Add one part; `id` auto-generated if omitted |
| `update_part(model, id, patch)` | Partial update of a part |
| `remove_part(model, id)` | Remove a part (and its children) |
| `apply_ops(model, ops[])` | Batch of add/update/remove in one atomic step (preferred for big edits) |
| `set_model(name, json)` | Replace the whole model after validation |
| `render(model, views?, size?)` | PNG(s) returned as MCP image content. Views: `front`, `back`, `left`, `top`, `iso`, `wireframe`. Default `["iso","front","top"]` |
| `measure(model)` | Bounding box, centre of mass, part overlaps/gaps, asymmetry warnings, forward-axis check |
| `undo(model)` / `redo(model)` | Walk the history |
| `export_glb(model, path?)` | Write a `.glb` (three `GLTFExporter`, run in headless page) |
| `duplicate_model(from, to)` | Branch a design to try variations |

Tool descriptions must tell Claude to: **render after every meaningful change, check front + top + side views, and call `measure` before declaring done.**

## UI features
- Viewport with orbit camera, grid, axes gizmo and an arrow showing the forward direction. Toggles for wireframe, mirror ghost and bounding box.
- Part list (tree by group/parent): select, rename, hide, lock, delete, duplicate.
- Inspector for the selected part: shape, size, pos/rot/scale, colour, emissive, flat shading, mirror.
- Transform gizmo (move/rotate/scale, with snapping) directly on the part.
- Undo/redo (Ctrl+Z/Y), shared with Claude's edits.
- Model list with new/duplicate/delete, and a raw JSON tab.
- Live updates: when Claude edits, the UI updates immediately, and the changed part flashes briefly.
- Conflict rule: edits carry `baseRevision`. If stale, the server rejects them and the client refetches. Claude re-reads and retries.
- "Ask Claude" hint box showing the MCP command and example prompts.

## Shared builder (`src/shared/buildModel.ts`)
`buildModel(spec): THREE.Group`, used by the UI, the render page and the game.
- Handles mirroring, parenting and materials, and reuses geometries.
- The renderer must not depend on the editor, so the game can import it alone.

## Suggested repo layout
```
model-lab/
  package.json
  CLAUDE.md                 # conventions above + tool-use guidance
  models/                   # JSON files (commit these)
  src/shared/               # schema.ts, buildModel.ts, ops.ts (pure)
  src/server/               # index.ts, mcp.ts, store.ts, render.ts, ws.ts
  src/ui/                   # React app
```

## Milestones
1. **Core, no UI:** schema, `applyOps`, store with history, `buildModel`. Unit-test ops with plain scripts.
2. **MCP server + render:** all tools except `export_glb`/`measure`. *Check:* Claude Code creates a ship, renders it, and fixes a deliberately misplaced wing from the screenshots.
3. **UI viewer:** live view, part list, inspector. Edits from Claude show up instantly.
4. **UI editing:** gizmo, undo/redo, create/duplicate/delete, raw JSON tab.
5. **Quality tools:** `measure`, `export_glb`, templates, example prompts.
6. **Game integration:** copy `schema.ts` and `buildModel.ts` into the game (or publish as a small package) and load `models/ship.json`.

## Acceptance test
In Claude Code: *"Create a sleek fighter ship, swept-back wings, twin engines with a blue glow, a small cockpit."* Claude should call `create_model`, `apply_ops`, and `render`, inspect the images, correct mistakes, and report a `measure` result. You then open the UI, drag a wing, and Claude's next `get_model` shows your change.

## Risks and decisions
- **Claude's 3D spatial accuracy is the main risk.** Rendering plus `measure` mitigate it; keep the primitive set small and the tools batch-oriented.
- **Headless render cost:** keep one warm Chromium instance, render at 512 px by default.
- **Keep models small:** aim for under 40 parts per model, to keep diffs readable and edits reliable.
- **Open question:** whether to add a CSG/boolean shape later (e.g. `three-bvh-csg`) for cut-outs. Skip for v1.

## Prompt to start with in Claude Code
> Read `docs/model-lab-spec.md` and implement milestones 1 and 2. Keep `src/shared` free of DOM and Node APIs. After each milestone, run it and show me it working before continuing.
