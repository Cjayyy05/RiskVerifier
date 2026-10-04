import { createHash } from "node:crypto";
import { InvalidInputError } from "../domain/index.js";

/** Bounded, detached JSON data only. Accessors are rejected without invocation. */
export function data(input: unknown): unknown {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 600000 || depth > 32) throw new InvalidInputError("Evidence data exceeds bounds");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string") {
      characters += value.length;
      if (value.length > 1500000 || characters > 32000000)
        throw new InvalidInputError("Evidence text exceeds bounds");
      return value;
    }
    if (typeof value !== "object" || value === null || ancestors.has(value))
      throw new InvalidInputError("Evidence must be acyclic JSON data");
    const array = Array.isArray(value);
    if (
      Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) &&
      !(Object.getPrototypeOf(value) === null && !array)
    )
      throw new InvalidInputError("Evidence has an unsupported prototype");
    const keys = Reflect.ownKeys(value);
    if (array && (value.length > 32768 || keys.length !== value.length + 1))
      throw new InvalidInputError("Evidence arrays must be dense and bounded");
    ancestors.add(value);
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || (array && !/^(0|[1-9][0-9]*)$/u.test(key)))
        throw new InvalidInputError("Unexpected evidence property");
      characters += key.length;
      if (key.length > 1500000 || characters > 32000000)
        throw new InvalidInputError("Evidence property names exceed bounds");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new InvalidInputError("Evidence accessors and hidden properties are forbidden");
      entries.push([key, visit(descriptor.value, depth + 1)]);
    }
    ancestors.delete(value);
    if (array) {
      if (entries.some(([key], index) => key !== String(index)))
        throw new InvalidInputError("Evidence arrays must be dense");
      return entries.map(([, item]) => item);
    }
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries);
  };
  return visit(input, 0);
}

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new InvalidInputError("Unexpected evidence record fields");
  return value as Record<string, unknown>;
}

export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > 10)
    throw new InvalidInputError("Expected at most ten selected-check entries");
  return value;
}

export function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new InvalidInputError("Invalid evidence identity");
  return value;
}

export function integer(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new InvalidInputError("Invalid evidence limit");
  return value;
}

export function canonical(value: unknown): string {
  return JSON.stringify(data(value));
}
export function digest(namespace: string, value: unknown): string {
  return createHash("sha256")
    .update(`riskverifier:${namespace}\n`)
    .update(canonical(value))
    .digest("hex");
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
