---
"@agent-native/core": minor
---

Add an optional `guarantees` field to `defineAction` — a small, typed set of
machine-checkable promises an action makes about its behavior (`read-only`,
`idempotent`, `reversible`, `access-scoped`). It generalizes the existing
`readOnly` boolean so an autonomous agent (and in-loop processors / guardrails)
can reason about an action's safety _before_ invoking it.

- Additive and optional — every existing action keeps working untouched.
- A `read-only` guarantee reconciles with the `readOnly` boolean: it derives
  `readOnly: true` and throws at `defineAction` time if it contradicts an
  explicit `readOnly: false`, so the two can never disagree silently.
- Unknown guarantee values throw loudly (no silently-dropped typos).
- Declared guarantees are surfaced in the agent-facing tool metadata.
- New `assertActionGuarantee` test helper behaviorally verifies a declared
  `read-only` / `idempotent` / `reversible` guarantee against real behavior.

New exports from `@agent-native/core`: `ACTION_GUARANTEES`,
`normalizeGuarantees`, `describeGuaranteesForTool`, `assertActionGuarantee`,
and the `ActionGuarantee`, `GuaranteedAction`, `GuaranteeProbe` types.
