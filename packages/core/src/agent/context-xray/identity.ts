/**
 * Deterministic, order-independent serialization usable for equality and
 * cache-key purposes. Sound for the value kinds that show up in DB-row
 * snapshots — unlike a bare `JSON.stringify`, which throws on `bigint`, is
 * lossy on `Date`, and silently drops `undefined`-valued keys:
 *
 * - `bigint`     → `1n` rather than throwing.
 * - `Date`       → `Date(<ISO>)` rather than an ambiguous quoted ISO string
 *                  (so a Date and a string can't false-equal).
 * - `undefined`  → an explicit `undefined` token, including for object values,
 *                  so a present `undefined` key is distinguishable from absence.
 *
 * Keys are sorted so `{a,b}` and `{b,a}` stringify identically. This is the
 * single canonical structural-equality serializer in core; reuse it rather than
 * adding another divergent copy.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

export function normalizeToolCallInputForIdentity(
  input: unknown,
): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { rawInput: input };
}

export function parseToolInputForIdentity(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function toolPairKey(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(
    normalizeToolCallInputForIdentity(parseToolInputForIdentity(input)),
  )}`;
}
