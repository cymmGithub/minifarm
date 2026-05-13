# Minifarm About — Public Showcase Site

Standalone Vite + React site deployed to Vercel. Renders the same About content
the dashboard shows internally, but as a public, image-optimized, no-API page.

## Local development

```
npm install
npm run dev
```

## Build

```
npm run build       # production build to dist/
npm run preview     # serve dist/ locally
```

## Image optimization

Source images live in `../dashboard/public/about/` (the dashboard's originals).
Optimized variants for this site live in `public/about/`. Regenerate with:

```
npm run optimize-images
```

This generates 3 widths × 2 formats per source image (640/1280/1920 × webp/jpg).
The script is idempotent — it skips files whose outputs are newer than the source.

## Relationship to the dashboard

The dashboard at `../dashboard/` has its own copy of `AboutSection.tsx` for
VPN-only internal users. The version here is a separate copy. They will drift.

### Public-version edits applied to AboutSection.tsx

When syncing changes from the dashboard's About, re-apply these edits:

| Find (dashboard version)                              | Replace with (this version)                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `'[MINIFARM] user@minifarm-master: ~ $'`              | `'[MINIFARM] przemek@minifarm-master: ~ $'`                |
| `the full application stack. Client nodes`            | `the application stack being tested. Client nodes`         |
| `./minifarm.js test MN-4000`                          | `./minifarm.js test feature-branch`                        |
| `│ Checkout tests      │` (in pipeline diagram)       | `│ Checkout repo       │`                                  |
| `import { useScrollReveal } from '../hooks/...'`      | `import { useScrollReveal } from './hooks/...'`            |
| `<img src="/about/X.jpg">`                            | `<ResponsivePicture base="X" ...>`                         |

Plus: the `<header>` bar inside `<article>` (links back to GitHub) is unique
to this version.

### Update procedure

When the dashboard's `AboutSection.tsx` changes:

1. `diff ../dashboard/src/components/AboutSection.tsx src/AboutSection.tsx`
2. Manually port relevant changes
3. Re-apply the table edits above
4. If new photos: drop into `../dashboard/public/about/`, run `npm run optimize-images`
5. Local check: `npm run dev`, visit all sections, click lightbox
6. Commit and push — Vercel auto-deploys

## Deployment

Connected to Vercel project; deploys from `master`. Vercel "Root Directory"
is set to `about/`. The first deploy is wired through the Vercel dashboard
(see project README); subsequent deploys are automatic on push.

## Why not a shared workspace package?

Considered (Approach C in the design spec) and rejected for this iteration —
restructuring the monorepo into bun workspaces is bigger than the showcase
scope. If the dashboard's About changes often enough that manual sync hurts,
revisit.
