@AGENTS.md

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# Cockpit v4

A multi-industry operations platform — CRM, documents, tasks, chat, calendar,
and AI ("Control Tower") — for accountants, notaries, agencies, and beyond.
Successor to cockpit-v3; not a fork.

**Canonical architecture doc:** `docs/architecture.html` (bilingual EN/FR).
Read it before making structural changes.

## What this is

Cockpit serves **firms** (accountants, notaries, agencies) who in turn serve
**customers** (their clients). Each firm is a workspace; each customer is the
scope every module hangs off (documents, tasks, threads, calendar events).

Two layers:

- **Core** — always installed. Workspaces, customers, documents, tasks,
  threads, calendar, audit, prereq engine, Control Tower. The core is itself
  a module (`isBuiltIn: true`) and contributes four generic task types:
  `core.todo`, `core.document_request`, `core.review`, `core.meeting`.

- **Modules** — declarative manifests under `modules/<id>/`. Each contributes
  routes, task type renderers, AI tools, calendar generators, artifact
  renderers, prerequisites, and guardrails. Industry modules (accounting,
  notary) are first-party for now. The registry lives at `modules/registry.ts`.

Two user populations on one Clerk app (Clerk Organizations are **not** used —
dropped in Phase 2.0; membership is modelled in our own `memberships` table):

- **Firm members** — plain Clerk users linked to a workspace via a
  `memberships` row. Use the firm shell (`app/(app)/...`). Roles: `owner` or
  `member`. Scope: `all` or `assigned_only`.
- **Clients** — plain Clerk users linked via `customer_access`. Use the
  client portal (`app/portal/...`).
- **Superadmins** — a third actor kind (`superadmins` table) that can
  impersonate any workspace through the `/admin` console.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) · React 19 |
| Styling | Tailwind v4 (`@theme inline` tokens in `app/globals.css`) |
| Fonts | Inter Tight (sans + display) + JetBrains Mono |
| UI primitives | shadcn (`new-york` style, `neutral` base) — `components/ui/*` |
| Backend | Convex |
| Auth | Clerk (`@clerk/nextjs`) — plain users, **no Organizations** (membership lives in Convex) |
| Icons | lucide-react |
| Package mgr | **pnpm 11** (never yarn/npm) |

There is no dark theme by design. Don't add `next-themes` usage (it's a
transitive dep of sonner; ignore it).

## Commands

```bash
pnpm dev          # runs next dev (port 3011) + convex dev concurrently
pnpm dev:next     # next only
pnpm dev:convex   # convex only (first-time setup is interactive)
pnpm build        # production build
pnpm typecheck    # tsc --noEmit (use this; there's no eslint yet)
```

Dev port is **3011** (v3 runs on 3010). Both can run side-by-side.

## Route architecture

```
app/
  page.tsx                                   ← landing (server, redirects signed-in users)
  layout.tsx                                 ← root: fonts, providers
  globals.css

  onboarding/create-workspace/page.tsx       ← /onboarding/create-workspace (first-run)

  (app)/                                     ← firm shell (route group, no URL)
    layout.tsx                               ← ⭐ single AppShell + breadcrumb logic
    customers/page.tsx                       ← /customers
    customers/[id]/page.tsx                  ← /customers/[id]
    customers/[id]/tasks/page.tsx            ← + tasks/[taskId]/page.tsx (detail)
    customers/[id]/documents/page.tsx
    customers/[id]/chat/page.tsx
    calendar/page.tsx                        ← /calendar (workspace overview)
    activity/page.tsx                        ← /activity (client-thread feed)
    settings/page.tsx                        ← /settings
    settings/team/page.tsx                   ← /settings/team
    admin/page.tsx                           ← /admin (superadmin console)
    debug/page.tsx                           ← /debug — smoke tests

  portal/                                    ← client portal (real folder, real URL prefix)
    layout.tsx                               ← portal shell
    page.tsx                                 ← /portal (customer picker / auto-redirect)
    c/[customerId]/page.tsx                  ← /portal/c/[customerId]
    c/[customerId]/{tasks,documents,messages}/  ← + tasks/[taskId]/page.tsx (detail)

  sign-in/, sign-up/                         ← Clerk catch-all routes
```

**Per-customer task routes** live under `app/(app)/customers/[id]/<feature>/...`
(tasks, documents, chat are wired). Never create top-level task routes.

## ⭐ The AppShell pattern (from v3)

The firm shell (`AppShell` component + `LeftSidebar` + `TopBar`) lives only in
`app/(app)/layout.tsx`. **Pages must NOT render `<AppShell>` themselves.**
This is why navigating between routes inside `(app)` doesn't remount the rail
or flicker.

Same rule for the portal: `PortalShell` lives only in `app/portal/layout.tsx`.

### Adding a new firm-shell route

1. Create `app/(app)/<route>/page.tsx`. Return only the page content (no shell wrapper).
2. Wrap the body in `<PageShell>` and lead with `<PageHeader>` (both in
   `components/layout/`) — don't hand-roll the `px-8 py-8` wrapper or the
   `text-3xl` title.
3. If it's a top-level nav target, add a `RailButton` in `components/layout/left-sidebar.tsx`.

### Adding a new per-customer task route

1. Create `app/(app)/customers/[id]/<feature>/page.tsx`.
2. Add a `RailButton` inside the `{inCustomerContext && (...)}` block in `left-sidebar.tsx`.

### Adding a new module

1. Create `modules/<id>/manifest.ts` exporting a `ModuleManifest`.
2. Register it in `modules/registry.ts` by adding to the `MODULES` array.
3. The manifest declares: nav entries (customer + portal), task types, message
   cards, artifacts, prerequisites, guardrails, AI tools, event handlers.
   See `modules/types.ts` for the full contract.

## Authorization

Every Convex function that touches user data calls `getActor(ctx)` from
`convex/lib/auth.ts`. It resolves the Clerk subject → `users` row, then returns
one of three actor kinds (checked in this precedence order):

- `{ kind: "superadmin", activeWorkspaceId?, sessionId?, effectiveRole: "owner" }`
  — an active impersonation session wins over everything. Without a session, a
  superadmin lands in "limbo" (no `activeWorkspaceId`) and must pick a workspace.
- `{ kind: "member", workspaceId, membership, role, scope, ... }` — resolved
  from the `memberships` table (`by_user` index), not Clerk Orgs.
- `{ kind: "client", customerAccess: [...] }` — resolved from `customer_access`.

`tryGetActor(ctx)` is the null-on-no-access variant. Use it when "not signed
in" is an expected state (e.g. `whoAmI`). Otherwise use `getActor` and let
it throw.

Helper functions: `isMember`, `isClient`, `isSuperadmin`, `canActInWorkspace`,
`canManageTeam`, `canManageModules`, `canListAllWorkspaces`,
`canSeeCustomer(ctx, actor, customerId)`.

## Convex schema

24 core tables in `convex/schema.ts`:

- **Tenancy**: `workspaces`, `memberships`, `team_invites`, `users`
- **Customer access**: `customers`, `customer_assignments`, `customer_access`, `client_invites`
- **Work**: `documents`, `tasks`, `task_approvals`
- **Communication**: `threads`, `thread_members`, `messages`
- **Workflow**: `calendar_events`, `events`, `inbox_items`, `audit_log`
- **Modules**: `module_settings`, `connectors`, `connector_imports`, `control_tower_sessions`
- **Superadmin**: `superadmins`, `superadmin_sessions`

Module substrates (accounting's `accounts` / `ledger_entries` / `vat_returns`,
notary's `signature_requests`, etc.) live under `convex/modules/<id>/schema.ts`
and are merged in when those modules ship.

## Design tokens (in `app/globals.css`)

```
--fmu-navy: #092448 | --fmu-navy-2: #122e57
--fmu-green: #1c764d | --fmu-green-2: #239961
--fmu-yellow: #ffbb00 | --fmu-red: #df0a28

--background: #f6f5f1 (cream)  --card: #ffffff  --card-tint: #fbfaf6
--line: #e7e3d8 | --line-2: #d8d3c4
--ink: #0c1a30 → --ink-2 → --ink-3 → --ink-4 (lightest)

Tailwind utilities auto-generated for every --color-* token:
  bg-fmu-navy, text-ink-3, border-line-2, bg-card-tint, etc.
```

## Conventions

- **Numbers** use `.num` class (JetBrains Mono + tabular-nums).
- **Status labels** use `<span className="pill pill--{kind}">…</span>`.
  Kinds: `draft` / `blocked` / `review` / `uploading` / `processing` /
  `completed` / `filed` / `balanced` / `neutral` / `failed`.
- **Page scaffolding** — wrap pages in `<PageShell>` and lead with
  `<PageHeader>` (`components/layout/`). Don't re-implement the `px-8 py-8`
  wrapper or the `text-3xl font-semibold tracking-tight` title; the header's
  `eyebrow` / `backHref` / `count` / `badge` / `meta` / `actions` slots cover
  the common shapes. (No breadcrumbs — dropped in Phase 2.0.)
- **Shared utilities** — date/size/initials formatting lives in
  `lib/formatters.ts`; loading/empty placeholders use `<LoadingState>` /
  `<EmptyState>` from `components/states.tsx`. Don't copy-paste local copies.
- **Eyebrows** (`<div className="eyebrow">…</div>`) are for *context* (e.g.
  "Workspace" above "Calendar"), not for restating the page title.
- **The AI assistant is called "Control Tower"** (product term).
- **Currency is MUR by default;** copy assumes Mauritian context.
- **No `filter()` in Convex queries** — define indexes and use `withIndex`.

## Project status — Phase 2.0

The scaffold is long behind us; core CRUD is built end-to-end (firm shell +
client portal, with real Convex queries/mutations throughout).

**Built (Phase 1.0 → 2.0):**

- Workspace onboarding + Clerk JWT integration (issuer
  `https://known-squid-86.clerk.accounts.dev`); `getActor` / `whoAmI`.
- Superadmin foundation: `superadmins` table, impersonation sessions, banner,
  `/admin` console.
- Customers — CRUD with inline-edit + archive (`convex/customers.ts`).
- Documents — upload via Convex File Storage, tags, visibility, archive
  (`convex/documents.ts`).
- Tasks — CRUD, status transitions, client visibility, generic detail page with
  per-type renderer dispatch (`convex/tasks.ts`).
- Threads + messages — per-customer internal + shared client threads, task
  `#chips`, system cards (`convex/threads.ts`, `convex/messages.ts`).
- Calendar — per-customer (task due-dates surface as events) plus a
  workspace-wide overview (`convex/calendar.ts`).
- Team — members, roles, magic-link invites via `convex/team.ts` +
  `convex/clerkInvites.ts`; managed at `/settings/team`.
- Client portal — customer picker, dashboard, tasks, documents, messages.
- Dropped Clerk Organizations; membership now lives in the `memberships` table.

**Not built yet (later phases):**

- **Control Tower** (the AI assistant) — only the `control_tower_sessions`
  table exists; no queries/mutations/UI.
- **Industry modules** (accounting, notary) — commented out in
  `modules/registry.ts`; only `core` is registered. Module substrate schemas
  under `convex/modules/<id>/` don't exist yet.
- **Prerequisite engine** and **connectors** — schema tables only, no logic.

See `docs/architecture.html` § Roadmap for what's next.

## Known issues / gotchas

- **pnpm 11 supply-chain policy.** Set in `pnpm-workspace.yaml`:
  `minimumReleaseAge: 0` (relaxed for dev velocity) and `allowBuilds` lists
  `@clerk/shared`, `esbuild`, `sharp` as approved native-binary postinstalls.
- **pnpm `pnpm` field in package.json is ignored in v11.** Use
  `pnpm-workspace.yaml` instead.
- **Convex auto-appends `_creationTime` to every index.** Don't list it
  explicitly in `.index(...)` — it errors at deploy.
- **`<SignedIn>` / `<SignedOut>` are deprecated in Clerk 7.** Use
  `<Show when="signed-in">` / `<Show when="signed-out">`.
- **Middleware lives in `proxy.ts`** (not `middleware.ts`) — Next 16 / Clerk 7
  convention.
- **`docs/architecture.html` is the canonical product spec.** Update it (or
  flag the drift) when making architectural changes.
