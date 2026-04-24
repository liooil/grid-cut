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

Uses a **fixed-size box** approach: the user picks a tile size (e.g. 512×512 px), then places boxes on the image to mark regions to extract. All boxes are the same size.

- `src/image-splitter/split-engine.ts` — Contains `computeTiledLayout()` which evenly distributes tiles across the image with configurable overlap (used for SD upscaling tiling). Also retains the Sobel-based edge detection pipeline (`autoDetectSplits`, `autoDetectFreeSplits`) for potential future use.
- `src/image-splitter/SplitCanvas.tsx` — Interactive canvas that renders the image with coloured box overlays. Supports pointer-based click-to-select, drag-to-move, and a × remove button on the selected box. Uses ResizeObserver for responsive layout and `devicePixelRatio` for HiDPI rendering.

Box positions are stored as **fractions [0, 1]** of image dimensions, making them resolution-independent. The canvas displays them by multiplying by the current display size.

### Other key files

- `src/index.ts` — Bun HTTP server with file routes and API endpoints. All unmatched routes serve `index.html`.
- `src/index.html` — Shell HTML with a `<div id="root">` and module script pointing at `frontend.tsx`.
- `src/frontend.tsx` — React entry point: calls `createRoot()` and renders `<App>`. Uses `import.meta.hot.data` for HMR.
- `src/App.tsx` — Main tool page: image upload, box size controls (pixels), overlap controls, auto-arrange grid layout, manual box placement, and tile extraction with preview grid.
- `build.ts` — Production build script using `Bun.build()` with `bun-plugin-tailwind` for CSS bundling.
- `styles/globals.css` — Tailwind v4 CSS with `@theme` for shadcn CSS variables, light/dark variant support.
- `src/index.css` — App-specific styles imported by `App.tsx`.
- `components.json` — shadcn/ui configuration (path aliases, style settings).
- `src/sample.png` — Sample image auto-loaded on dev start.

### Path aliases

- `@/*` maps to `./src/*` — used for imports (e.g., `@/components/ui/button`).

### Component library

shadcn/ui components live in `src/components/ui/` and use the `cn()` utility from `src/lib/utils.ts` (clsx + tailwind-merge). Currently includes: Button, Card, Input, Label, Select, Textarea.

### Notable patterns

- **HMR**: the dev server uses Bun's built-in HMR via `bun --hot`. The client entry (`frontend.tsx`) uses `import.meta.hot.data` to preserve the React root across hot reloads.
- **No routing library**: the server uses Bun's `serve()` with a catch-all route (`/*`), so client-side routing can be added without server changes.
