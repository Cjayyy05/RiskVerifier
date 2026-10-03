import path from "node:path";
import { createHash } from "node:crypto";
import { InvalidInputError } from "../domain/index.js";

/** Descriptor inspection precedes field reads; transport DTOs, not a hostile-Proxy sandbox. */
export function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new InvalidInputError("Execution record must be a plain object");
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype)
    throw new InvalidInputError("Execution record must be plain data");
  if (Reflect.ownKeys(input).length !== keys.length)
    throw new InvalidInputError("Execution record has unexpected or missing fields");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new InvalidInputError("Execution fields must be own enumerable data properties");
  }
  return input as Record<string, unknown>;
}

export function list(input: unknown, maximum: number): readonly unknown[] {
  if (
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    throw new InvalidInputError("Execution array must be bounded and dense");
  for (let i = 0; i < input.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new InvalidInputError("Execution arrays must contain data, not accessors or holes");
  }
  return input;
}

export function text(input: unknown, maximum = 4096, empty = false): string {
  if (
    typeof input !== "string" ||
    (!empty && input.length === 0) ||
    input.length > maximum ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input)
  )
    throw new InvalidInputError("Execution string is invalid or exceeds its bound");
  return input;
}

export function integer(input: unknown, minimum: number, maximum: number): number {
  if (
    typeof input !== "number" ||
    !Number.isSafeInteger(input) ||
    input < minimum ||
    input > maximum
  )
    throw new InvalidInputError("Execution integer is outside its bound");
  return input;
}

export function absolutePath(input: unknown): string {
  const value = text(input);
  // No relative, device, UNC, ADS, dot-segment or trailing-dot/space aliases.
  if (
    !path.isAbsolute(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    path.normalize(value) !== value ||
    value.split(/[\\/]/u).some((part) => part === ".." || part === "." || /[. ]$/u.test(part)) ||
    (process.platform === "win32" && !/^[a-z]:\\[^:]*$/iu.test(value))
  )
    throw new InvalidInputError("Execution paths must be normalized absolute local paths");
  return value;
}

export function contained(root: string, candidate: string, allowRoot = false): boolean {
  const relative = path.relative(root, candidate);
  return (
    (allowRoot || relative !== "") &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function digest(input: unknown): string {
  if (typeof input !== "string" || !/^[a-f0-9]{64}$/u.test(input))
    throw new InvalidInputError("Execution digest must be canonical SHA-256");
  return input;
}

/** Only rebuilt records are frozen; caller-owned values must never be frozen in place. */
export function freeze<T>(input: T): T {
  if (input !== null && typeof input === "object") {
    for (const value of Object.values(input)) freeze(value);
    Object.freeze(input);
  }
  return input;
}

export function same(left: unknown, right: unknown): boolean {
  // For exact fixed-key records reconstructed by factories, not arbitrary caller JSON.
  return JSON.stringify(left) === JSON.stringify(right);
}
