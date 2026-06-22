import type { ActionRunContext } from "./action.js";
import { stableStringify } from "./agent/context-xray/identity.js";

/**
 * Machine-checkable promises an action makes about its own behavior.
 *
 * An action's `description` says what it *does*; its `guarantees` say what it
 * *promises*. Because agent-native actions are picked and invoked autonomously
 * by an LLM agent (and inspected by in-loop processors / guardrails), a typed,
 * machine-readable promise layer lets a caller reason about an action *before*
 * invoking it — fewer footguns when the agent acts without a human in the loop.
 *
 * This is the principled generalization of the existing `readOnly` boolean (see
 * `defineAction` in `action.ts`) into a small, typed set. Keep the vocabulary
 * SMALL: it is far easier to add a value later than to remove one once templates
 * depend on it.
 *
 * - `read-only`     — no writes / side-effects. Supersedes/aligns with the
 *                     existing `readOnly` boolean: declaring this implies
 *                     `readOnly: true`, and the two can never disagree silently.
 * - `idempotent`    — calling N times has the same effect as calling once.
 * - `reversible`    — the effect can be undone (e.g. archive / soft-delete with
 *                     a restore path).
 * - `access-scoped` — every read/write enforces ownable access checks
 *                     (`accessFilter` / `resolveAccess` / `assertAccess`).
 */
export type ActionGuarantee =
  | "read-only"
  | "idempotent"
  | "reversible"
  | "access-scoped";

/** The closed set of recognized guarantee values. Source of truth for both the
 *  type above and runtime validation in {@link normalizeGuarantees}. */
export const ACTION_GUARANTEES = [
  "read-only",
  "idempotent",
  "reversible",
  "access-scoped",
] as const;

function isActionGuarantee(value: unknown): value is ActionGuarantee {
  return (
    typeof value === "string" &&
    (ACTION_GUARANTEES as readonly string[]).includes(value)
  );
}

/**
 * Validate + normalize a declared `guarantees` value into a deduplicated,
 * vocabulary-checked array (or `undefined` when nothing meaningful is declared).
 *
 * Unlike the framework's "drop malformed metadata silently" pattern for purely
 * advisory fields (link / mcpApp / publicAgent), guarantees are a *contract*: a
 * typo such as `"readonly"` or `"idempotant"` would be a silent footgun that an
 * autonomous agent might trust. So an unknown value throws loudly at
 * `defineAction` time (module load), where the developer sees it immediately.
 *
 * Returns `undefined` for `undefined` / non-array / empty input so existing
 * actions stay byte-for-byte untouched and `entry.guarantees` is only present
 * when the author opted in.
 */
export function normalizeGuarantees(
  value: unknown,
): ActionGuarantee[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid action "guarantees": expected an array of ${ACTION_GUARANTEES.join(
        " | ",
      )}, received ${typeof value}.`,
    );
  }
  const seen = new Set<ActionGuarantee>();
  for (const raw of value) {
    if (!isActionGuarantee(raw)) {
      throw new Error(
        `Unknown action guarantee ${JSON.stringify(
          raw,
        )}. Valid guarantees are: ${ACTION_GUARANTEES.join(", ")}.`,
      );
    }
    seen.add(raw);
  }
  return seen.size > 0 ? [...seen] : undefined;
}

/** Render guarantees as a compact, model-facing line appended to a tool's
 *  description so the agent can read an action's promises while choosing a tool.
 *  Returns the original description unchanged when there are no guarantees. */
export function describeGuaranteesForTool(
  description: string,
  guarantees: readonly ActionGuarantee[] | undefined,
): string {
  if (!guarantees || guarantees.length === 0) return description;
  return `${description}\n\nGuarantees (the caller can rely on these): ${guarantees.join(
    ", ",
  )}.`;
}

// ---------------------------------------------------------------------------
// Behavioral assertion helper for tests
// ---------------------------------------------------------------------------

/** Minimal structural shape this helper needs from an action — satisfied by the
 *  object returned from `defineAction` and by a raw `ActionEntry`. */
export interface GuaranteedAction {
  guarantees?: readonly ActionGuarantee[];
  run: (args: any, ctx?: ActionRunContext) => unknown | Promise<unknown>;
}

/** Inputs for a behavioral guarantee probe. Which fields are required depends
 *  on the guarantee being asserted (see {@link assertActionGuarantee}). */
export interface GuaranteeProbe {
  /** Args passed to the action's `run`. */
  args?: unknown;
  /** Optional run context forwarded to `run`. */
  ctx?: ActionRunContext;
  /**
   * Snapshot the observable state the guarantee constrains (e.g. the relevant
   * DB rows). Called before/after `run` and deep-compared. Required for
   * `read-only`, `idempotent`, and `reversible`.
   */
  observe?: () => unknown | Promise<unknown>;
  /**
   * Undo the action's effect, given `run`'s result. Required for `reversible`.
   */
  undo?: (result: unknown) => unknown | Promise<unknown>;
}

/**
 * Structural equality for the snapshots `observe()` returns. Built on the
 * canonical {@link stableStringify} from context-xray's identity module, which
 * is sound for the value kinds common in DB-row snapshots: `Date` (compared by
 * its instant, not lost), `bigint` (compared, never throws), and `undefined`
 * object values (distinguished from absence). We deliberately reuse that single
 * serializer instead of keeping another local `JSON.stringify`-based copy, which
 * would throw on `bigint` and silently mis-compare `Date` / `undefined`.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Behaviorally verify that an action actually honors a guarantee it declares.
 *
 * Fails (throws) if the action declares `guarantee` but the probe proves it
 * false — wire this into a unit test so a declared promise can't silently rot.
 * It first asserts the action *declares* the guarantee, so the test is
 * meaningful, then runs the matching behavioral probe:
 *
 * - `read-only`  — `observe()` must be unchanged after `run`.
 * - `idempotent` — `observe()` after one call must equal `observe()` after a
 *                  second identical call.
 * - `reversible` — `observe()` after `run` then `undo(result)` must match the
 *                  pre-run snapshot.
 * - `access-scoped` — not behaviorally assertable in isolation; assert it with
 *                  your normal access-control tests (unauthorized caller is
 *                  denied). This helper throws to say so explicitly.
 *
 * `observe()` must return ONLY the field(s) the guarantee constrains — exclude
 * incidental metadata like `updatedAt`. Snapshotting a whole row would false-fail
 * `reversible`/`read-only`: archive *and* restore bump `updatedAt`, so the
 * before/after rows differ on a column the guarantee never promised to preserve.
 *
 * @example
 * await assertActionGuarantee(archiveDashboard, "reversible", {
 *   args: { id, archived: true },
 *   // Project ONLY the constrained field, not the whole row — `updatedAt`
 *   // changes on both archive and restore and would false-fail the assertion.
 *   observe: async () => (await readDashboardRow(id)).archivedAt,
 *   undo: () => archiveDashboard.run({ id, archived: false }),
 * });
 */
export async function assertActionGuarantee(
  action: GuaranteedAction,
  guarantee: ActionGuarantee,
  probe: GuaranteeProbe = {},
): Promise<void> {
  if (!action.guarantees || !action.guarantees.includes(guarantee)) {
    throw new Error(
      `Action does not declare the "${guarantee}" guarantee, so asserting it is meaningless. Declared: ${
        action.guarantees && action.guarantees.length
          ? action.guarantees.join(", ")
          : "(none)"
      }.`,
    );
  }

  const run = (args: unknown) => action.run(args, probe.ctx);

  if (guarantee === "access-scoped") {
    throw new Error(
      `The "access-scoped" guarantee is not behaviorally assertable by assertActionGuarantee. ` +
        `Verify it with an access-control test (an unauthorized caller must be denied).`,
    );
  }

  if (typeof probe.observe !== "function") {
    throw new Error(
      `Asserting the "${guarantee}" guarantee requires a probe.observe() function to snapshot state.`,
    );
  }

  if (guarantee === "read-only") {
    const before = await probe.observe();
    await run(probe.args);
    const after = await probe.observe();
    if (!deepEqual(before, after)) {
      throw new Error(
        `Guarantee "read-only" violated: observed state changed after running the action.\n` +
          `Before: ${stableStringify(before)}\nAfter:  ${stableStringify(after)}`,
      );
    }
    return;
  }

  if (guarantee === "idempotent") {
    await run(probe.args);
    const afterFirst = await probe.observe();
    await run(probe.args);
    const afterSecond = await probe.observe();
    if (!deepEqual(afterFirst, afterSecond)) {
      throw new Error(
        `Guarantee "idempotent" violated: a second identical call changed observed state.\n` +
          `After 1 call:  ${stableStringify(afterFirst)}\nAfter 2 calls: ${stableStringify(afterSecond)}`,
      );
    }
    return;
  }

  // guarantee === "reversible"
  if (typeof probe.undo !== "function") {
    throw new Error(
      `Asserting the "reversible" guarantee requires a probe.undo(result) function to undo the effect.`,
    );
  }
  const before = await probe.observe();
  const result = await run(probe.args);
  await probe.undo(result);
  const restored = await probe.observe();
  if (!deepEqual(before, restored)) {
    throw new Error(
      `Guarantee "reversible" violated: state did not return to its pre-run value after undo.\n` +
        `Before:   ${stableStringify(before)}\nRestored: ${stableStringify(restored)}`,
    );
  }
}
