# Cockpit v4

A multi-industry operations platform — CRM, documents, tasks, chat, calendar,
and AI ("Control Tower") — for accountants, notaries, agencies, and beyond.

Successor to cockpit-v3; not a fork.

## Quick start

```bash
pnpm install
pnpm dev:convex   # first time only — interactive Convex setup
pnpm dev          # then run both servers concurrently (next on :3011, convex)
```

You'll also need:

- A Clerk application with Organizations enabled. Set
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`.
- A JWT template named `convex` in Clerk dashboard → JWT Templates.
- The issuer domain set in both `.env.local`
  (`CLERK_JWT_ISSUER_DOMAIN=https://<your-instance>.clerk.accounts.dev`)
  and on the Convex deployment (`pnpm exec convex env set CLERK_JWT_ISSUER_DOMAIN "..."`).

## Docs

- **Architecture brief** (the source of truth): `docs/architecture.html` —
  open in a browser, toggle EN/FR top right.
- **Repo guide for Claude / agents**: `CLAUDE.md`.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · shadcn ·
Convex · Clerk · lucide-react · pnpm 11.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run next + convex concurrently (port 3011) |
| `pnpm dev:next` | Next.js only |
| `pnpm dev:convex` | Convex only |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |

## Status

Phase 0 scaffold. See `CLAUDE.md` § Phase 0 status for what's wired and
`docs/architecture.html` § Roadmap for what's next.
