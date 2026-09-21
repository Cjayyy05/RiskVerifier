export type RiskVerifierErrorCode =
  "INVALID_INPUT" | "INVALID_CONFIGURATION" | "INVARIANT_VIOLATION";

export abstract class RiskVerifierError extends Error {
  public readonly code: RiskVerifierErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  protected constructor(
    code: RiskVerifierErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export class InvalidInputError extends RiskVerifierError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVALID_INPUT", message, details);
  }
}

export class InvalidConfigurationError extends RiskVerifierError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVALID_CONFIGURATION", message, details);
  }
}

export class InvariantViolationError extends RiskVerifierError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVARIANT_VIOLATION", message, details);
  }
}
