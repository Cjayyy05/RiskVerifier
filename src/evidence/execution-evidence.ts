import {
  InvalidInputError,
  createComponentVersion,
  type ChangeVerificationPlan,
} from "../domain/index.js";
import { validateVerificationPlan, type PlanningInput } from "../planning/index.js";
// Public pure entry point: riskverifier/execution/results. No executor or adapter import.
import {
  validateBoundResult,
  type ExecutionBinding,
  type ExecutionCheckResult,
} from "../execution/result.js";
import { canonical, data, digest, freeze, integer, list, record, text } from "./validation.js";

/** Must be independently retained from trusted capture, never reconstructed at untrusted intake. */
export interface ExecutionEvidenceReference {
  readonly binding: ExecutionBinding;
  readonly resultDigest: string;
}
export interface EvidenceInput {
  readonly planningInput: PlanningInput;
  readonly plan: ChangeVerificationPlan;
  readonly results: readonly ExecutionCheckResult[];
}
export interface ValidatedExecutionEvidence {
  readonly plan: ChangeVerificationPlan;
  /** Independently known produced evidence; absence here is trusted capture context. */
  readonly references: readonly ExecutionEvidenceReference[];
  readonly results: readonly {
    readonly result: ExecutionCheckResult;
    readonly resultDigest: string;
  }[];
}

const sha256 = /^[a-f0-9]{64}$/u;
const workspaceId =
  /^workspace:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function bindingFor(plan: ChangeVerificationPlan, input: unknown): ExecutionBinding {
  const value = record(input, [
    "executorVersion",
    "authorityId",
    "planId",
    "context",
    "check",
    "definition",
    "workspace",
  ]);
  const check = plan.checks.find((candidate) => canonical(candidate) === canonical(value.check));
  if (
    !check ||
    value.executorVersion !== "7.1.0" ||
    value.planId !== plan.id ||
    canonical(value.context) !== canonical(plan.context)
  )
    throw new InvalidInputError("Evidence binding does not match the replayed plan or executor");
  const definition =
    value.definition === null
      ? null
      : record(value.definition, ["id", "version", "maxOutputBytes", "timeoutMs"]);
  const workspace = record(value.workspace, ["id", "snapshotSha256"]);
  return {
    executorVersion: createComponentVersion("7.1.0"),
    authorityId: text(value.authorityId, /^authority:sha256:[a-f0-9]{64}$/u),
    planId: plan.id,
    context: plan.context,
    check,
    definition:
      definition === null
        ? null
        : {
            id: text(definition.id, /^definition:sha256:[a-f0-9]{64}$/u),
            // Intentional rejection of control characters in producer version labels.
            // eslint-disable-next-line no-control-regex
            version: text(definition.version, /^[^\x00-\x1f\x7f]{1,128}$/u),
            maxOutputBytes: integer(definition.maxOutputBytes, 1048576),
            timeoutMs: integer(definition.timeoutMs, 2147483647),
          },
    workspace: {
      id: text(workspace.id, workspaceId),
      snapshotSha256: text(workspace.snapshotSha256, sha256),
    },
  };
}

/** Capture only at a trusted Phase 7 output boundary, with independently known binding. */
export function captureExecutionEvidence(
  planningInput: PlanningInput,
  suppliedPlan: ChangeVerificationPlan,
  trustedBinding: ExecutionBinding,
  candidate: unknown,
): ExecutionEvidenceReference {
  const plan = validateVerificationPlan(planningInput, suppliedPlan);
  const binding = bindingFor(plan, data(trustedBinding));
  const result = validateBoundResult(binding, data(candidate));
  return freeze({ binding, resultDigest: digest("execution-evidence", result) });
}

/** Replays the plan and validates ALL supplied evidence before any verdict can be emitted. */
export function validateExecutionEvidence(
  input: EvidenceInput,
  trustedReferences: readonly ExecutionEvidenceReference[],
): ValidatedExecutionEvidence {
  const envelope = record(data(input), ["planningInput", "plan", "results"]);
  const plan = validateVerificationPlan(
    envelope.planningInput as PlanningInput,
    envelope.plan as ChangeVerificationPlan,
  );
  const references = new Map<string, ExecutionEvidenceReference>();
  for (const entry of list(data(trustedReferences))) {
    const value = record(entry, ["binding", "resultDigest"]);
    const binding = bindingFor(plan, value.binding);
    if (references.has(binding.check.id))
      throw new InvalidInputError("Duplicate trusted check reference");
    references.set(binding.check.id, { binding, resultDigest: text(value.resultDigest, sha256) });
  }
  const results = new Map<string, { result: ExecutionCheckResult; resultDigest: string }>();
  const attempts = new Set<string>();
  const workspaces = new Set<string>();
  for (const candidate of list(envelope.results)) {
    const value = record(candidate, ["binding", "attemptId", "state", "observation"]);
    const binding = bindingFor(plan, value.binding);
    const reference = references.get(binding.check.id);
    if (!reference || results.has(binding.check.id))
      throw new InvalidInputError("Missing independent reference or duplicate check result");
    const result = validateBoundResult(reference.binding, candidate);
    const resultDigest = digest("execution-evidence", result);
    if (resultDigest !== reference.resultDigest)
      throw new InvalidInputError(
        "Execution evidence differs from its independently retained digest",
      );
    if (attempts.has(result.attemptId) || workspaces.has(result.binding.workspace.id))
      throw new InvalidInputError("Execution attempts and single-use workspaces cannot be reused");
    attempts.add(result.attemptId);
    workspaces.add(result.binding.workspace.id);
    results.set(binding.check.id, { result, resultDigest });
  }
  return freeze({
    plan,
    references: plan.checks.flatMap((check) => {
      const reference = references.get(check.id);
      return reference ? [reference] : [];
    }),
    results: plan.checks.flatMap((check) => {
      const found = results.get(check.id);
      return found ? [found] : [];
    }),
  });
}
