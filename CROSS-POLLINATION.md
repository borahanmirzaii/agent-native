# Cross-Pollination: `agent-native` ⇄ `nlx` (`n8n-langhain`)

> A working spec for what two sibling projects — one a TypeScript **run-time app
> framework**, the other a Python **compose-time delivery spine** — can learn
> from and lend to each other. Both make the same bet: **delegable, honest
> intelligence**. They just stand at different points in the arc.

- **Status:** Draft / discussion
- **Date:** 2026-06-20
- **Author:** borahanmirzaii (with Claude acting as Lead)
- **Repos:** [`agent-native`](https://github.com/borahanmirzaii/agent-native) · [`n8n-langhain`](https://github.com/borahanmirzaii/n8n-langhain)

---

## 1. Why this document exists

`agent-native` and `nlx` were designed independently, in different languages, at
different layers of the stack. Yet when you read their *core abstractions* side
by side, they turn out to be the same idea expressed twice. This spec names that
shared DNA, then proposes concrete, low-risk ways each project can borrow from
the other — and one bigger bet where they snap together.

This is a **thinking + planning** artifact, not an implementation. Nothing here
mutates either codebase. Each proposal is sized so it could become its own
GitHub Issue.

---

## 2. The shared DNA

Strip away TS-vs-Python and both projects rest on one conviction: **describe a
capability declaratively; let something else wire it up.**

| Concept | `agent-native` | `nlx` |
|---|---|---|
| Unit of capability | `defineAction({ description, schema, run })` | `Contract` + `Port.execute(inputs) -> dict` |
| Self-description | `description` + `zod` schema (agent *and* UI call it) | `contract.yaml`: `guarantees`, `requires`, JSON Schema |
| Composition | features compose actions; the agent picks them as tools | `workflow.yaml` `wiring:` pipes one contract's output into the next's input |
| Inversion of control | agent knows the action surface, not the impl | "core knows nothing about concrete adapters — that inversion is the load-bearing invariant" |
| Ground truth | `application_state` in SQL | the Doctor's versioned **status contract** (JSON) |

Both perform **dependency inversion at the capability layer** (the high-level
caller names *what* it wants; a low-level adapter supplies *how*). `agent-native`
calls the seam an **action**; `nlx` calls it a **port/contract**. Same hexagon,
different altitude.

```
  nlx  (compose-time)               agent-native  (run-time)
  ───────────────────               ──────────────────────────
  contracts → workflow   ──emits──▶ an action surface + SQL app
  Doctor status contract ────────▶  application_state / cockpit UI
```

They even share taste: both keep a **spec/plan convention** under
`docs/superpowers/{specs,plans}`, and both expose a **JSON seam** that a separate
UI reads without coupling.

---

## 3. What `agent-native` can learn from `nlx`

### 3.1 Guarantees as first-class action metadata
`nlx` contracts carry machine-checkable promises — `guarantees: [{id:
grounded-summary}]`, `claim-traceability`. Agent-native actions describe *what
they do* (prose `description`) but not *what they promise*.

**Proposal:** an optional `guarantees` field on `defineAction` (e.g.
`idempotent`, `access-scoped`, `read-only`, `reversible`) that the agent can
reason over and the framework can assert in tests. `readOnly` already hints at
this — generalize it.

### 3.2 Mechanically-enforced architecture boundaries
`nlx` uses **import-linter** so `core` literally *cannot* import an adapter.
Agent-native states equivalent rules in `AGENTS.md` in English ("client code
imports named helpers instead of hand-writing REST calls", "no `.js` source",
"actions are the single source of truth") but enforces them socially, at review.

**Proposal:** encode the highest-value invariants as lint contracts — e.g. a
rule that template code may not call `fetch` against framework routes, or that
nothing outside `packages/core` imports a SQLite-only API. Convention → guardrail.

### 3.3 A clean compose-time / run-time split
`nlx`'s composer derives a stack, then **stays out of the request path**.
Agent-native deliberately blends the two (the agent can rewrite the running
app) — powerful, but it widens the blast radius.

**Proposal:** keep blending where it earns its keep, but borrow the *posture* —
label which agent capabilities are "compose-time" (scaffold, migrate, edit
source) vs "run-time" (call actions, read state) so the riskier set is explicit.

---

## 4. What `nlx` can learn from `agent-native`

### 4.1 A live agent that calls the contracts as tools
`nlx` composes capabilities beautifully but is headless and batch-shaped. Its
contracts are *already tool-shaped* (`Port.execute(inputs) -> dict`); they simply
lack an agent holding them.

**Proposal:** expose a generated instance's contracts as an agent tool surface —
the agent-native move of "the same surface is callable by both a human UI and an
LLM agent." This gives `nlx` a conversational front door without violating its
inward-only invariant (the agent sits *outside* the spine, like the CLI does).

### 4.2 Live `application_state`, not just after-the-fact status
The Doctor's status contract is read-only observability *after* a run.
Agent-native keeps *live* state ("what is the user looking at") so the agent acts
in-context.

**Proposal:** let a running instance publish live state over the same JSON seam,
so a cockpit (or agent) can see in-flight progress, not only post-hoc verdicts.

### 4.3 Optimistic, real-time UX over the JSON seam
The meta-cockpit reads static status JSON. Agent-native's `useDbSync()` /
polling pattern keeps a UI live and optimistic.

**Proposal:** make the cockpit subscribe to the status seam (poll or stream)
instead of loading fixtures, so instance health updates without a refresh.

---

## 5. The bigger bet: where they snap together

They sit at **different layers**, which is exactly why they could compose.

### 5.1 `nlx` as a generator *for* `agent-native`
A `nlx` workflow (e.g. `proposal-generation`: `search → summarize → generate`)
maps almost 1:1 onto a set of agent-native **actions** plus a template.

**Spike:** teach `nlx`'s `projector` / `targets` to emit an agent-native
`templates/*` app — each contract becomes a `defineAction`, each `wiring:` edge
becomes an action that composes the prior ones. Output: a runnable agent-native
template derived from a contract graph.

### 5.2 `agent-native` as the cockpit *for* `nlx`
Instead of a standalone Next.js `cockpit/`, model the Doctor's status contract as
an agent-native data model. The in-app agent then *answers questions about* and
*acts on* nlx instances ("which contracts are degraded? re-run the failing one").

**Spike:** an agent-native mini-app that ingests `status-contract.schema.json`
output, renders it, and exposes a `rerun-contract` action.

```
   nlx workflow (contracts + wiring)
            │  project
            ▼
   agent-native template (actions + SQL + agent chat)
            │  run + observe
            ▼
   status contract  ◀── agent-native cockpit reads + acts
```

---

## 6. The north star both share

Peel back the stack choices and both projects make the **same bet: make
intelligence delegable and honest.**

- **No magic black box.** `nlx` insists on an *honest* Doctor and traceable
  guarantees; agent-native insists the agent and human see the *same* state and
  the *same* actions — no hidden agent-only powers.
- **The human is a principal, not a spectator.** You declare intent at a high
  level; a faithful machine carries it out *while showing its work*.

The only real difference is **where each stands to help**:

- `nlx` helps **at the moment of assembly** — compose a trustworthy delivery
  stack, prove it honestly, then get out of the way.
- `agent-native` helps **at the moment of use** — a living app where you and the
  agent collaborate in real time.

Compose-time honesty + run-time collaboration are two halves of one arc. That's
why these projects are **complementary, not competing**.

---

## 7. Suggested next steps (each could be one Issue)

| # | Item | Repo | Size |
|---|---|---|---|
| 1 | `guarantees` field on `defineAction` | agent-native | S |
| 2 | Encode top architecture invariants as lint contracts | agent-native | M |
| 3 | Expose nlx contracts as an agent tool surface | nlx | M |
| 4 | Live `application_state` seam for running instances | nlx | M |
| 5 | Cockpit subscribes to status seam (live, not fixtures) | nlx | S |
| 6 | **Spike:** nlx workflow → agent-native template projection | both | L |
| 7 | **Spike:** agent-native cockpit for nlx status contracts | both | L |

> Items 1–5 are independent and safe to pick up à la carte. Items 6–7 are the
> load-bearing bets and should each get a brainstorm + spec before code.
