import { InvalidInputError } from "./errors.js";

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${field} must be a non-empty string`, { field });
  }

  if (/\p{Cc}/u.test(value)) {
    throw new InvalidInputError(`${field} must not contain control characters`, { field });
  }

  return value;
}

export function requireIdentityString(value: unknown, field: string): string {
  const candidate = requireNonEmptyString(value, field);
  if (candidate.trim() !== candidate) {
    throw new InvalidInputError(`${field} must not contain surrounding whitespace`, { field });
  }
  if (/\p{Cf}/u.test(candidate)) {
    throw new InvalidInputError(`${field} must not contain Unicode format controls`, { field });
  }

  return candidate;
}

export function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInputError(`${field} must be a non-negative safe integer`, { field });
  }

  return value;
}

export function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidInputError(`${field} must be a safe integer`, { field });
  }

  return value;
}

export function requireIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new InvalidInputError(`${field} must be an ISO-8601 timestamp`, { field });
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value) {
    throw new InvalidInputError(`${field} must be a canonical ISO-8601 timestamp`, { field });
  }

  return value;
}

export function requireEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new InvalidInputError(`${field} contains an unsupported value`, {
      allowed,
      field,
      value,
    });
  }

  return value;
}

export function requirePlainObject(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInputError(`${field} must be an object`, { field });
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidInputError(`${field} must be a plain object`, { field });
  }

  return value as Readonly<Record<string, unknown>>;
}

export function requireArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new InvalidInputError(`${field} must be an array`, { field });
  }

  return value;
}

export function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  field: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new InvalidInputError(`${field} contains unexpected fields`, {
      field,
      unexpected,
    });
  }
}
