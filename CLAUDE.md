# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `bun dev` (starts hot-reloading server at localhost:3000)
- **Build:** `bun run build` (outputs minified bundle to `dist/`)
- **Production:** `bun start` (serves built files without HMR)
- **Add shadcn/ui component:** `bunx shadcn@latest add <component>`
- **Dependency install:** `bun add <pkg>`
- **Type check:** `bunx tsc --noEmit`

## Architecture

This is a **Bun + React 19** full-stack app using **Tailwind CSS v4** with **shadcn/ui** (New York style) and **lucide-react** icons.

### Image Splitter (`src/image-splitter/`)

The split engine works in four steps:

1. **Downsample** — large images are scaled to ≤500px on the longest edge for performance.
2. **Sobel edge detection** — computes gradient magnitude at each pixel (Rec. 601 luma), then sums per row and per column to build 1-D profiles.
3. **Smooth & normalise** — moving-average smoothing, then scale to [0, 1].
4. **Find splits** — for each split line, search a tolerance window (±25% of section size) around the evenly-spaced ideal position and pick the index with the **lowest** gradient (smoothest region).

Split positions are stored as **fractions [0, 1]** of image dimensions, making them resolution-independent. The canvas displays them by multiplying by the current display size.

### Other key files

- `src/index.ts` — Bun HTTP server with file routes and API endpoints. All unmatched routes serve `index.html`.
- `src/index.html` — Shell HTML with a `<div id="root">` and module script pointing at `frontend.tsx`.
- `src/frontend.tsx` — React entry point: calls `createRoot()` and renders `<App>`. Uses `import.meta.hot.data` for HMR.
- `src/App.tsx` — Image Splitter tool (replaced the template). This is the main page: image upload, split controls, split-line canvas, and tile extraction.
- `src/image-splitter/split-engine.ts` — Content-aware split detection. Uses Sobel edge detection to compute gradient profiles, then finds optimal split positions in uniform (low-gradient) regions. Supports configurable tolerance and downsampling for performance.
- `src/image-splitter/SplitCanvas.tsx` — Interactive canvas overlay. Renders the image with split lines, drag handles, and position labels. Supports pointer-based drag to adjust lines. Uses ResizeObserver for responsive layout and `devicePixelRatio` for HiDPI rendering.
- `build.ts` — Production build script using `Bun.build()` with `bun-plugin-tailwind` for CSS bundling.
- `styles/globals.css` — Tailwind v4 CSS with `@theme` for shadcn CSS variables, light/dark variant support.
- `src/index.css` — App-specific styles imported by `App.tsx`.
- `components.json` — shadcn/ui configuration (path aliases, style settings).

### Path aliases

- `@/*` maps to `./src/*` — used for imports (e.g., `@/components/ui/button`).

### Component library

shadcn/ui components live in `src/components/ui/` and use the `cn()` utility from `src/lib/utils.ts` (clsx + tailwind-merge). Currently includes: Button, Card, Input, Label, Select, Textarea.

### Notable patterns

- **HMR**: the dev server uses Bun's built-in HMR via `bun --hot`. The client entry (`frontend.tsx`) uses `import.meta.hot.data` to preserve the React root across hot reloads.
- **No routing library**: the server uses Bun's `serve()` with a catch-all route (`/*`), so client-side routing can be added without server changes.
