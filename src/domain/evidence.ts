import {
  parseCheckResultState,
  parseEvidenceCompleteness,
  parseEvidenceSensitivity,
  parseVerificationStrategy,
  type CheckResultState,
  type EvidenceCompleteness,
  type EvidenceSensitivity,
  type VerificationStrategy,
} from "./enums.js";
import { InvalidInputError } from "./errors.js";
import { deepFreeze } from "./immutable.js";
import {
  createCheckAttemptId,
  createArtifactDigest,
  createCommitIdentity,
  createConfigurationIdentity,
  createComponentVersion,
  createEvidenceId,
  createPolicyVersion,
  createRepositoryIdentity,
  createVerificationCheckId,
  createVerificationRunId,
  type ArtifactDigest,
  type CheckAttemptId,
  type CommitIdentity,
  type ComponentVersion,
  type ConfigurationIdentity,
  type EvidenceId,
  type PolicyVersion,
  type RepositoryIdentity,
  type VerificationCheckId,
  type VerificationRunId,
} from "./identities.js";
import { requireArray, requireIsoTimestamp, requireNonEmptyString } from "./validation.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Readonly<Record<string, JsonValue>>;

const MAX_EVIDENCE_JSON_DEPTH = 64;
const MAX_EVIDENCE_JSON_NODES = 10_000;

interface JsonCloneBudget {
  nodes: number;
}

function cloneJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  depth: number,
  budget: JsonCloneBudget,
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > MAX_EVIDENCE_JSON_NODES) {
    throw new InvalidInputError(`fact exceeds the maximum JSON node count`, {
      maximumNodes: MAX_EVIDENCE_JSON_NODES,
    });
  }
  if (depth > MAX_EVIDENCE_JSON_DEPTH) {
    throw new InvalidInputError(`fact exceeds the maximum JSON nesting depth`, {
      maximumDepth: MAX_EVIDENCE_JSON_DEPTH,
      path,
    });
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(`${path} must contain only finite JSON numbers`, { path });
    }
    return value;
  }

  if (typeof value !== "object") {
    throw new InvalidInputError(`${path} must contain only JSON values`, { path });
  }

  if (ancestors.has(value)) {
    throw new InvalidInputError(`${path} must not contain cyclic data`, { path });
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        cloneJsonValue(item, `${path}[${index}]`, ancestors, depth + 1, budget),
      );
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidInputError(`${path} must contain only plain JSON objects`, { path });
    }

    const result: Record<string, JsonValue> = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor)) {
        throw new InvalidInputError(`${path} must not contain accessor properties`, { path });
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneJsonValue(descriptor.value, `${path}.${key}`, ancestors, depth + 1, budget),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function cloneJsonObject(value: unknown): JsonObject {
  const cloned = cloneJsonValue(value, "fact", new WeakSet(), 0, { nodes: 0 });
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new InvalidInputError("fact must be a JSON object", { field: "fact" });
  }
  return cloned;
}

export interface EvidenceRunContext {
  readonly runId: VerificationRunId;
  readonly repository: RepositoryIdentity;
  readonly baseCommit: CommitIdentity;
  readonly targetCommit: CommitIdentity;
  readonly policyVersion: PolicyVersion;
  readonly configuration: ConfigurationIdentity;
}

export interface Evidence {
  readonly id: EvidenceId;
  readonly kind: string;
  readonly context: EvidenceRunContext;
  readonly producer: string;
  readonly producerVersion: ComponentVersion;
  readonly subjectIds: readonly string[];
  readonly strategy?: VerificationStrategy;
  readonly checkId?: VerificationCheckId;
  readonly attemptId?: CheckAttemptId;
  readonly resultState?: CheckResultState;
  readonly createdAt: string;
  readonly fact: JsonObject;
  readonly sourceEvidenceIds: readonly EvidenceId[];
  readonly completeness: EvidenceCompleteness;
  readonly sensitivity: EvidenceSensitivity;
  readonly payloadDigest?: ArtifactDigest;
}

export function createEvidenceRunContext(input: {
  readonly runId: unknown;
  readonly repository: unknown;
  readonly baseCommit: unknown;
  readonly targetCommit: unknown;
  readonly policyVersion: unknown;
  readonly configuration: ConfigurationIdentity;
}): EvidenceRunContext {
  return deepFreeze({
    runId: createVerificationRunId(input.runId),
    repository: createRepositoryIdentity(input.repository),
    baseCommit: createCommitIdentity(input.baseCommit),
    targetCommit: createCommitIdentity(input.targetCommit),
    policyVersion: createPolicyVersion(input.policyVersion),
    configuration: createConfigurationIdentity(input.configuration),
  });
}

export function createEvidence(input: {
  readonly id: unknown;
  readonly kind: unknown;
  readonly context: EvidenceRunContext;
  readonly producer: unknown;
  readonly producerVersion: unknown;
  readonly subjectIds: readonly unknown[];
  readonly strategy?: unknown;
  readonly checkId?: unknown;
  readonly attemptId?: unknown;
  readonly resultState?: unknown;
  readonly createdAt: unknown;
  readonly fact: JsonObject;
  readonly sourceEvidenceIds?: readonly unknown[];
  readonly completeness: unknown;
  readonly sensitivity: unknown;
  readonly payloadDigest?: unknown;
}): Evidence {
  const context = createEvidenceRunContext(input.context);
  const strategy =
    input.strategy === undefined ? undefined : parseVerificationStrategy(input.strategy);
  const checkId =
    input.checkId === undefined ? undefined : createVerificationCheckId(input.checkId);
  const attemptId =
    input.attemptId === undefined ? undefined : createCheckAttemptId(input.attemptId);
  const resultState =
    input.resultState === undefined ? undefined : parseCheckResultState(input.resultState);
  const payloadDigest =
    input.payloadDigest === undefined ? undefined : createArtifactDigest(input.payloadDigest);
  const subjectIds = requireArray(input.subjectIds, "subjectIds").map((value) =>
    requireNonEmptyString(value, "subjectId"),
  );

  if (subjectIds.length === 0) {
    throw new InvalidInputError("Evidence requires at least one subject ID");
  }
  if (checkId !== undefined && strategy === undefined) {
    throw new InvalidInputError("Evidence associated with a check must identify its strategy");
  }
  if (attemptId !== undefined && checkId === undefined) {
    throw new InvalidInputError("Evidence associated with an attempt must identify its check");
  }
  if (resultState !== undefined && (checkId === undefined || attemptId === undefined)) {
    throw new InvalidInputError(
      "Evidence associated with a result must identify its check and attempt",
    );
  }

  return deepFreeze({
    id: createEvidenceId(input.id),
    kind: requireNonEmptyString(input.kind, "evidenceKind"),
    context,
    producer: requireNonEmptyString(input.producer, "producer"),
    producerVersion: createComponentVersion(input.producerVersion),
    subjectIds,
    ...(strategy === undefined ? {} : { strategy }),
    ...(checkId === undefined ? {} : { checkId }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(resultState === undefined ? {} : { resultState }),
    createdAt: requireIsoTimestamp(input.createdAt, "createdAt"),
    fact: cloneJsonObject(input.fact),
    sourceEvidenceIds: (input.sourceEvidenceIds ?? []).map(createEvidenceId),
    completeness: parseEvidenceCompleteness(input.completeness),
    sensitivity: parseEvidenceSensitivity(input.sensitivity),
    ...(payloadDigest === undefined ? {} : { payloadDigest }),
  });
}
