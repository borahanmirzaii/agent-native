---
"@agent-native/core": patch
---

Follow-ups from the `defineAction` `guarantees` review (non-blocking polish):

- **Surface guarantees over MCP, not just the in-process agent.** The MCP tool
  descriptor now appends declared guarantees to the tool description and maps
  them onto annotations (`idempotent` → `idempotentHint`, plus the full set
  under an `agent-native/guarantees` annotation). External MCP agents — the
  autonomous, no-human-in-the-loop callers this feature targets — now see the
  same promises the in-process agent does.
- **Precompute the guarantees description once.** The augmented, model-facing
  description is computed at `defineAction` time and stored on the entry
  (`toolDescriptionWithGuarantees`); the per-request paths (`actionsToEngineTools`
  and the MCP descriptor) read it instead of recomputing on every request.
- **Single `readOnly` decision site.** The `read-only` guarantee now folds into
  the existing `readOnly` resolution (it implies `readOnly: true`, with the
  explicit `readOnly: false` contradiction still throwing) instead of a separate
  branch above a nested ternary — one place decides `readOnly`.

Additive and behavior-preserving for existing actions; no public API removed.
