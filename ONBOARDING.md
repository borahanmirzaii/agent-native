# Agent-Native — Senior Solo Builder Onboarding

> One-page mental model for the whole system, written for someone who owns the
> codebase end-to-end. Read this once, then keep the **Skill Index** (in
> `AGENTS.md` / `CLAUDE.md`) open as your daily reference. A visual companion to
> this file lives at [`ONBOARDING.html`](./ONBOARDING.html) — open it in a
> browser.

---

## 1. The one-sentence thesis

**Don't choose between a rich UI and an autonomous agent — ship both off one
contract.** Everything the UI can do, the agent can do, because both call the
*same* action surface backed by the *same* SQL state. No "AI bolted on the
side."

```ts
// One action powers UI, agent, HTTP, MCP, A2A, and CLI — all of them.
export default defineAction({
  description: "Get a single email by ID, including its full body.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  run: async ({ id }) => {
    /* read scoped SQL, return data */
  },
});
```

If you internalize one thing: **the `Action` is the atom of the system.** UI,
agent, API, MCP, A2A, and CLI are all just *callers* of actions.

---

## 2. What this repo is

This is the **framework + the showcase apps**, not a single product:

- **`packages/core/`** — `@agent-native/core`, the framework runtime. The CLI,
  the agent loop, the action engine, server plugins, the Vite plugin, sync, auth,
  collab, observability. This is the published npm package that template apps
  depend on. **Most "how does the magic work" answers live here.**
- **`templates/*`** — 15 complete, cloneable SaaS apps (mail, calendar, slides,
  analytics, content, plan, clips, …). Each is a *standalone* app with its own
  Drizzle schema, `actions/`, `app/` (React), and `server/` (Nitro). They are
  how-it's-done references **and** the products users fork.
- **`packages/{dispatch,scheduling,pinpoint,embedding,migrate,frame,…}`** —
  satellite packages: workspace control plane (vault/integrations), scheduling
  primitives, visual feedback, embedding SDK, migration workbench, dev frame.
- **`.agents/skills/` + `skills/`** — prose playbooks the agent reads *before*
  touching an area. Treat these as the real docs; `AGENTS.md`/`CLAUDE.md` are
  deliberately thin and point here.

Monorepo: **pnpm workspaces**, Node ≥ 22, TypeScript everywhere (no `.js`/`.mjs`
source). Upstream is `BuilderIO/agent-native`; your `origin` is your fork.

---

## 3. The architecture in one diagram

```
                 ┌──────────────────────────────────────────────┐
                 │                  USER                         │
                 └───────┬───────────────────────┬──────────────┘
                clicks   │                       │  asks (chat)
                         ▼                       ▼
        ┌────────────────────────┐   ┌────────────────────────────┐
        │   React Frontend       │   │   Agent Runtime (Claude)    │
        │  app/ — CSR app pages  │   │  packages/core/src/agent    │
        │  useActionQuery /      │   │  tools = your actions       │
        │  useActionMutation     │   │  + skills + memory + jobs   │
        └───────────┬────────────┘   └──────────────┬─────────────┘
                    │                               │
                    │      SAME ACTION SURFACE       │
                    └───────────────┬───────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │  actions/*  (defineAction)     │   ← single source of truth
                    │  schema (zod) + run()          │
                    └───────────────┬───────────────┘
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │  Nitro server  (server/) + framework plugins          │
        │  /_agent-native/*  routes  ·  auth/context  ·  poll    │
        └───────────────────────────┬──────────────────────────┘
                                    ▼
        ┌──────────────────────────────────────────────────────┐
        │  SQL  via Drizzle  (any DB: SQLite/Postgres/libSQL)    │
        │  app data  ·  application_state  ·  threads  ·  state  │
        └──────────────────────────────────────────────────────┘
                                    │
                     change → useDbSync() polls /_agent-native/poll
                              (+ SSE fast-path, + CRDT for collab)
                                    │
                                    ▼   UI re-renders, agent stays aware
```

**The loop that makes it "agent-native":** any write (from UI *or* agent) lands
in SQL → the sync layer notifies every connected surface → the UI updates and
the agent's view of `application_state` stays current. Neither side is special.

---

## 4. Core modules (where to look when…)

| You want to understand…                | Look here                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| How an action is defined & dispatched  | `packages/core/src/action.ts`, `action-ui.ts`                  |
| The agent loop / tools / processors    | `packages/core/src/agent/`                                     |
| SQL schema, DB adapters, migrations    | `packages/core/src/db/`, a template's `server/db/`             |
| App state the agent reads              | `packages/core/src/application-state/`                         |
| Real-time sync & polling               | `packages/core/src/` sync + `/_agent-native/poll` plugin       |
| Server routes / plugins / auth context | `packages/core/src/server/`, `router/`, a template `server/`   |
| MCP / A2A / external agents            | `packages/core/src/mcp/`, `mcp-client/`, `a2a/`                |
| Collaborative editing (Yjs CRDT)       | `packages/core/src/collab/`                                    |
| Skills, memory, onboarding, jobs       | `packages/core/src/{onboarding,jobs,triggers,settings}/`       |
| Extensions (sandboxed mini-apps)       | `packages/core/src/extensions/`                                |
| Credentials / vault / integrations     | `packages/core/src/{credentials,secrets,integrations}/`, `packages/dispatch/` |
| CLI (`npx @agent-native/core …`)       | `packages/core/src/cli/`                                       |

A template's anatomy (e.g. `templates/mail/`):

```
actions/     defineAction files — the capability surface (agent tools + UI calls)
app/         React Router app: pages/, components/, routes.ts, root.tsx
server/      Nitro: db/, routes/, plugins/, middleware/, handlers/, lib/
shared/      code shared between client + server
data/        seed / example data
AGENTS.md    app-specific agent rules    CLAUDE.md  human/agent project rules
drizzle.config.ts  ·  vite.config.ts  ·  package.json
```

---

## 5. The non-negotiable design patterns

These are the rules the codebase (and the guard scripts) enforce. Break them and
CI/`pnpm guards` will catch you.

1. **Actions are the single source of truth.** Define ops in `actions/` with
   `defineAction`. The agent gets them as tools; the frontend calls them via
   `useActionQuery` / `useActionMutation`. **Never** hand-write `fetch` to an app
   route — add a named client helper first, then teach it in a skill.
2. **No twin routes.** Don't wrap an action in a REST endpoint that re-exports
   it. Inspect existing actions before adding *any* custom Nitro route for app
   data. (`guard:no-action-twin-routes`.)
3. **Data lives in SQL via Drizzle, provider-agnostic.** Any SQL DB Drizzle
   supports, any host Nitro supports. Never assume SQLite. **Schema changes are
   additive only** — never drop/rename/truncate. Never `drizzle-kit push` at
   prod.
4. **Scoped access on ownable data.** Tables with `ownableColumns()` must read
   and write through `accessFilter` / `resolveAccess` / `assertAccess`. Custom
   routes must establish request context first. (Cross-tenant leak guards exist
   because real incidents happened.)
5. **App state belongs in `application_state` (SQL)** so the agent always knows
   the current navigation, selection, and focused object.
6. **All AI work goes through the agent chat.** UIs **never** call an LLM
   directly. Want AI in a button? Delegate to the agent (`delegate-to-agent`).
7. **Secrets are never hardcoded.** Vault/secrets own values; apps own
   app-specific readers. Use workspace integration grants, not copied tokens.
8. **Optimistic UI by default.** Update cache + navigate immediately, roll back
   on error. Spinners only for destructive/irreversible ops.
9. **The four-area rule:** every feature touches **UI · actions · skills/
   instructions · application state** when applicable. (`adding-a-feature`.)
10. **The agent can edit the app's own source.** Design UI and data flows so
    they're legible to an agent (`self-modifying-code`).

---

## 6. How data flows — two concrete traces

**A) User clicks "Archive" in the mail UI**
1. Button → `useActionMutation("archive-email", { id })` (optimistic cache update
   fires instantly).
2. Request hits the action surface → `archive-email` action's `run()`.
3. `run()` does a **scoped** Drizzle write (access checked via `resolveAccess`).
4. Write lands in SQL; `application_state` reflects the new selection/view.
5. `useDbSync()` (polling `/_agent-native/poll`, SSE fast-path when available)
   notifies every surface → other tabs, other users, and the **agent** see it.

**B) User types "archive everything from Stripe" in chat**
1. Agent runtime picks tools = the *same* actions (`list-emails`,
   `archive-email`, …).
2. Agent calls `list-emails` then `archive-email` — identical `run()`, identical
   scoping. No separate "AI path."
3. SQL write → sync → the UI updates live while the agent narrates.

Same atoms, same guarantees, both directions. That symmetry *is* the framework.

---

## 7. Daily workflow & commands

```bash
pnpm install                 # postinstall builds core + sibling packages
pnpm dev                     # lazy dev (recommended)
pnpm --filter mail dev       # run a single template
pnpm --filter @agent-native/core dev   # watch-build the framework

pnpm run prep                # fmt + typecheck + test + guards — RUN BEFORE PUSH
pnpm typecheck               # all packages + templates
pnpm test                    # core + migrate + docs + dispatch + brain evals
pnpm run guards              # the security/consistency guard suite
```

- **`DATABASE_URL`** unset → local SQLite at `data/app.db`. Set it for
  Postgres/Neon/Supabase/Turso. **`ANTHROPIC_API_KEY`** required for agent chat.
- **Changesets:** source changes in `packages/{core,dispatch,scheduling,pinpoint}`
  need a `.changeset/*.md`. Never bump versions by hand.
- **Guards = codified past incidents.** Read the header of any
  `scripts/guard-*.mjs` to see the invariant it protects.

---

## 8. Mental shortcuts that pay off

- **"Where do I add capability X?"** → an action. Almost always start there.
- **"How does the agent know about Y?"** → it's a tool (action) or it's in
  `application_state`. If the agent is blind to something, one of those is
  missing.
- **"Why isn't the UI updating?"** → sync/invalidation wiring (`real-time-sync`),
  not a re-render bug nine times out of ten.
- **"Can I just write a REST route?"** → almost never. Extend the action surface.
- **"Should this be one big app?"** → prefer many focused mini-apps that compose
  over A2A (`composable-mini-apps`).
- **Read the skill first.** `AGENTS.md`/`CLAUDE.md` are intentionally thin; the
  depth is in `.agents/skills/*`. The Skill Index is your map.

---

## 9. Three product shapes (same primitives)

| Shape       | You ship                                              | Underneath           |
| ----------- | ----------------------------------------------------- | -------------------- |
| **Headless**| Call agent + actions from code/CLI/HTTP/MCP/A2A.      | actions, auth, jobs  |
| **Rich chat**| Standalone/embedded chat with native tool renderers. | shared chat runtime  |
| **Whole app**| Full SaaS UI; chat moves sidebar↔center, stays synced.| SQL state + actions  |

You never rebuild the agent contract to change shape — you just wrap more (or
less) UI around the same actions.

---

## 10. First-week checklist

- [ ] `pnpm install && pnpm --filter mail dev` — get one template running with a
      local SQLite DB and `ANTHROPIC_API_KEY` set.
- [ ] Read one full action top-to-bottom (`templates/mail/actions/get-email.ts`)
      and trace its scoping + return shape.
- [ ] Open the mail UI, archive an email, then ask the agent to archive one —
      watch both hit the same action.
- [ ] Skim `packages/core/src/agent/` and `action.ts` to see the loop.
- [ ] Read `adding-a-feature`, `actions`, `storing-data`, `real-time-sync`,
      `security` skills — they cover ~80% of day-to-day work.
- [ ] Run `pnpm run prep` once so you know what green looks like before you push.

---

*Stack: pnpm monorepo · React (CSR app pages, SSR public) · Nitro server ·
Drizzle (any SQL) · Claude agent runtime · MCP/A2A protocols · Yjs CRDT collab.
Backend-agnostic by design — no lock-in.*
