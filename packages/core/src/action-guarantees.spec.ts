import { describe, it, expect } from "vitest";
import {
  ACTION_GUARANTEES,
  normalizeGuarantees,
  describeGuaranteesForTool,
  assertActionGuarantee,
  type ActionGuarantee,
  type GuaranteedAction,
} from "./action-guarantees.js";
import { defineAction } from "./action.js";
import { actionsToEngineTools } from "./agent/production-agent.js";

// ---------------------------------------------------------------------------
// normalizeGuarantees — validation + dedup
// ---------------------------------------------------------------------------
describe("normalizeGuarantees", () => {
  it("returns undefined for undefined/null/empty input (additive default)", () => {
    expect(normalizeGuarantees(undefined)).toBeUndefined();
    expect(normalizeGuarantees(null)).toBeUndefined();
    expect(normalizeGuarantees([])).toBeUndefined();
  });

  it("dedupes while preserving first-seen order", () => {
    expect(
      normalizeGuarantees(["idempotent", "read-only", "idempotent"]),
    ).toEqual(["idempotent", "read-only"]);
  });

  it("accepts every value in the published vocabulary", () => {
    expect(normalizeGuarantees([...ACTION_GUARANTEES])).toEqual([
      ...ACTION_GUARANTEES,
    ]);
  });

  it("throws on an unknown value", () => {
    expect(() => normalizeGuarantees(["reversable"])).toThrow(
      /Unknown action guarantee/,
    );
  });

  it("throws when given a non-array", () => {
    expect(() => normalizeGuarantees("read-only")).toThrow(/expected an array/);
  });
});

// ---------------------------------------------------------------------------
// describeGuaranteesForTool — model-facing surfacing
// ---------------------------------------------------------------------------
describe("describeGuaranteesForTool", () => {
  it("appends a guarantees line to the description", () => {
    const out = describeGuaranteesForTool("Archive a dashboard.", [
      "reversible",
      "access-scoped",
    ]);
    expect(out).toContain("Archive a dashboard.");
    expect(out).toMatch(/Guarantees.*reversible, access-scoped/);
  });

  it("returns the description unchanged when there are no guarantees", () => {
    expect(describeGuaranteesForTool("plain", undefined)).toBe("plain");
    expect(describeGuaranteesForTool("plain", [])).toBe("plain");
  });
});

// ---------------------------------------------------------------------------
// Guarantees appear in the agent-facing tool metadata
// ---------------------------------------------------------------------------
describe("actionsToEngineTools — guarantees in tool metadata", () => {
  it("surfaces declared guarantees in the model-facing tool description", () => {
    const registry = {
      "archive-thing": defineAction({
        description: "Archive a thing.",
        parameters: { id: { type: "string" } },
        guarantees: ["reversible", "access-scoped"],
        run: async () => "ok",
      }),
      "plain-thing": defineAction({
        description: "Do a thing.",
        parameters: { id: { type: "string" } },
        run: async () => "ok",
      }),
    } as any;

    const tools = actionsToEngineTools(registry);
    const archive = tools.find((t) => t.name === "archive-thing")!;
    const plain = tools.find((t) => t.name === "plain-thing")!;

    expect(archive.description).toMatch(
      /Guarantees.*reversible, access-scoped/,
    );
    // Actions without guarantees keep an unchanged description.
    expect(plain.description).toBe("Do a thing.");
  });
});

// ---------------------------------------------------------------------------
// assertActionGuarantee — behavioral verification helper
// ---------------------------------------------------------------------------
describe("assertActionGuarantee", () => {
  it("throws if the action does not declare the guarantee being asserted", async () => {
    const action: GuaranteedAction = { run: async () => "ok" };
    await expect(
      assertActionGuarantee(action, "idempotent", { observe: () => 0 }),
    ).rejects.toThrow(/does not declare the "idempotent" guarantee/);
  });

  it("passes for a genuinely read-only action and fails for a sneaky writer", async () => {
    let state = 0;
    const honest: GuaranteedAction = {
      guarantees: ["read-only"],
      run: async () => state, // reads only
    };
    await expect(
      assertActionGuarantee(honest, "read-only", { observe: () => state }),
    ).resolves.toBeUndefined();

    const liar: GuaranteedAction = {
      guarantees: ["read-only"],
      run: async () => {
        state += 1; // writes despite the promise
        return state;
      },
    };
    await expect(
      assertActionGuarantee(liar, "read-only", { observe: () => state }),
    ).rejects.toThrow(/"read-only" violated/);
  });

  it("passes for an idempotent upsert and fails for an append", async () => {
    const set = new Set<string>();
    const upsert: GuaranteedAction = {
      guarantees: ["idempotent"],
      run: async (args: { id: string }) => {
        set.add(args.id);
        return [...set];
      },
    };
    await expect(
      assertActionGuarantee(upsert, "idempotent", {
        args: { id: "a" },
        observe: () => [...set].sort(),
      }),
    ).resolves.toBeUndefined();

    const log: string[] = [];
    const append: GuaranteedAction = {
      guarantees: ["idempotent"],
      run: async (args: { id: string }) => {
        log.push(args.id); // grows on every call → not idempotent
        return [...log];
      },
    };
    await expect(
      assertActionGuarantee(append, "idempotent", {
        args: { id: "a" },
        observe: () => [...log],
      }),
    ).rejects.toThrow(/"idempotent" violated/);
  });

  it("passes for a reversible archive/restore and fails when undo is incomplete", async () => {
    const rows: Record<string, { archived: boolean }> = {
      d1: { archived: false },
    };
    const archive: GuaranteedAction = {
      guarantees: ["reversible"],
      run: async (args: { id: string; archived: boolean }) => {
        rows[args.id].archived = args.archived;
        return { id: args.id };
      },
    };

    await expect(
      assertActionGuarantee(archive, "reversible", {
        args: { id: "d1", archived: true },
        observe: () => ({ ...rows.d1 }),
        undo: (result) =>
          archive.run({ id: (result as { id: string }).id, archived: false }),
      }),
    ).resolves.toBeUndefined();

    // A broken undo that leaves residue must be caught.
    await expect(
      assertActionGuarantee(archive, "reversible", {
        args: { id: "d1", archived: true },
        observe: () => ({ ...rows.d1 }),
        undo: () => {
          /* forgets to restore */
        },
      }),
    ).rejects.toThrow(/"reversible" violated/);
  });

  it("requires an observe() probe for behavioral guarantees", async () => {
    const action: GuaranteedAction = {
      guarantees: ["read-only"],
      run: async () => "ok",
    };
    await expect(
      assertActionGuarantee(action, "read-only", {}),
    ).rejects.toThrow(/requires a probe.observe/);
  });

  it("refuses to behaviorally assert access-scoped (points at access-control tests)", async () => {
    const action: GuaranteedAction = {
      guarantees: ["access-scoped"],
      run: async () => "ok",
    };
    await expect(
      assertActionGuarantee(action, "access-scoped", { observe: () => 0 }),
    ).rejects.toThrow(/not behaviorally assertable/);
  });

  it("works against a real defineAction-produced action", async () => {
    let archived = false;
    const action = defineAction({
      description: "Archive a record.",
      parameters: { archived: { type: "string" } },
      guarantees: ["reversible"],
      run: async (args: { archived?: boolean }) => {
        archived = args.archived ?? true;
        return { archived };
      },
    }) as unknown as GuaranteedAction & { guarantees: ActionGuarantee[] };

    await expect(
      assertActionGuarantee(action, "reversible", {
        args: { archived: true },
        observe: () => archived,
        undo: () => action.run({ archived: false }),
      }),
    ).resolves.toBeUndefined();
  });
});
