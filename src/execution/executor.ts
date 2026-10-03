import { randomUUID } from "node:crypto";
import { InvalidInputError, type ChangeVerificationPlan } from "../domain/index.js";
import { validateVerificationPlan, type PlanningInput } from "../planning/index.js";
import {
  createAuthority,
  assertDefinitionAllowed,
  validatePrograms,
  executionEnvironment,
  type ExecutionAuthority,
} from "./authority.js";
import { boundedExecution } from "./bounded-execution.js";
import {
  EXECUTOR_VERSION,
  executionDefinitionId,
  validateExecutionConfiguration,
  type ExecutionConfiguration,
} from "./configuration.js";
import {
  acquireWorkspace,
  releaseWorkspace,
  validateWorkspaceFiles,
  workspaceMetadata,
  type ControlledWorkspace,
} from "./workspace.js";
import {
  noProcess,
  resultState,
  validateBoundResult,
  type ExecutionBinding,
  type ExecutionCheckResult,
  type ProcessObservation,
} from "./result.js";
import { freeze, record, same, text } from "./validation.js";

export interface ExecutionRequest {
  readonly planningInput: PlanningInput;
  readonly plan: ChangeVerificationPlan;
  readonly checkId: string;
  readonly configuration: ExecutionConfiguration;
  readonly workspace: ControlledWorkspace;
}
export interface ControlledExecutor {
  readonly version: typeof EXECUTOR_VERSION;
  readonly authorityId: string;
  executeCheck(request: ExecutionRequest, signal?: AbortSignal): Promise<ExecutionCheckResult>;
  /** Association/shape validation only; cannot authenticate fabricated historical observations. */
  validateResult(request: ExecutionRequest, supplied: unknown): ExecutionCheckResult;
}

function bindRequest(
  request: ExecutionRequest,
  authority: ExecutionAuthority,
): {
  binding: ExecutionBinding;
  definition: ExecutionConfiguration["definitions"][number] | undefined;
  workspace: ControlledWorkspace;
} {
  const value = record(request, ["planningInput", "plan", "checkId", "configuration", "workspace"]);
  const plan = validateVerificationPlan(
    value.planningInput as PlanningInput,
    value.plan as ChangeVerificationPlan,
  );
  const configuration = validateExecutionConfiguration(value.configuration);
  if (!same(configuration.identity, plan.context.configuration))
    throw new InvalidInputError("Execution configuration does not match the validated plan");
  const checkId = text(value.checkId, 256);
  const check = plan.checks.find((candidate) => candidate.id === checkId);
  if (!check) throw new InvalidInputError("Requested check is absent from this plan");
  const workspace = workspaceMetadata(value.workspace as ControlledWorkspace);
  if (
    workspace.repository !== plan.context.repository ||
    workspace.baseCommit !== plan.context.baseCommit ||
    workspace.targetCommit !== plan.context.targetCommit
  )
    throw new InvalidInputError("Controlled workspace source context does not match the plan");
  const definition = configuration.definitions.find(
    (candidate) => candidate.strategy === check.strategy,
  );
  if (definition) assertDefinitionAllowed(definition, authority);
  const binding: ExecutionBinding = freeze({
    executorVersion: EXECUTOR_VERSION,
    authorityId: authority.id,
    planId: plan.id,
    context: plan.context,
    check,
    definition: definition
      ? {
          id: executionDefinitionId(definition),
          version: definition.version,
          maxOutputBytes: definition.maxOutputBytes,
          timeoutMs: definition.timeoutMs,
        }
      : null,
    workspace: { id: workspace.id, snapshotSha256: workspace.snapshotSha256 },
  });
  return { binding, definition, workspace };
}

/** The only public route to local verification execution. One active check per instance/workspace. */
export async function createControlledExecutor(
  trustedAuthority: unknown,
): Promise<ControlledExecutor> {
  const authority = await createAuthority(trustedAuthority);
  let busy = false;
  let quarantined = false;
  return Object.freeze({
    version: EXECUTOR_VERSION,
    authorityId: authority.id,
    validateResult(request: ExecutionRequest, supplied: unknown): ExecutionCheckResult {
      return validateBoundResult(bindRequest(request, authority).binding, supplied);
    },
    async executeCheck(
      request: ExecutionRequest,
      signal?: AbortSignal,
    ): Promise<ExecutionCheckResult> {
      if (signal !== undefined && !(signal instanceof AbortSignal))
        throw new InvalidInputError("Cancellation requires a native AbortSignal");
      if (busy || quarantined)
        throw new InvalidInputError("This controlled executor is busy or quarantined");
      // All DTOs are copied/replayed before the first asynchronous preflight.
      const { binding, definition, workspace } = bindRequest(request, authority);
      acquireWorkspace(workspace);
      busy = true;
      let terminationConfirmed = true;
      try {
        let observation: ProcessObservation;
        if (signal?.aborted) observation = noProcess("CANCELLED");
        else if (!definition) observation = noProcess("DEFINITION_MISSING");
        else if (binding.check.availability !== "SUPPORTED")
          observation = noProcess("POLICY_UNAVAILABLE");
        else {
          let workspaceAvailable = true;
          try {
            await validateWorkspaceFiles(workspace);
          } catch (error) {
            if (error instanceof InvalidInputError) throw error;
            workspaceAvailable = false;
          }
          const missing = workspaceAvailable
            ? await validatePrograms(definition, authority, workspace.directory)
            : "WORKSPACE_UNAVAILABLE";
          if (signal?.aborted) observation = noProcess("CANCELLED");
          else if (missing) observation = noProcess(missing);
          else
            observation = await boundedExecution.run(
              {
                definition,
                directory: workspace.directory,
                environment: executionEnvironment(authority, workspace.directory),
              },
              signal,
            );
        }
        terminationConfirmed = observation.terminationConfirmed;
        if (!terminationConfirmed) quarantined = true;
        return validateBoundResult(binding, {
          binding,
          attemptId: `attempt:${randomUUID()}`,
          state: resultState(observation),
          observation,
        });
      } finally {
        busy = false;
        releaseWorkspace(workspace, terminationConfirmed);
      }
    },
  });
}
