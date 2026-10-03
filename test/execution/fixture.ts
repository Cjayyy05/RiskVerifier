import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import {
  createControlledExecutor,
  prepareControlledWorkspace,
  disposeControlledWorkspace,
  parseExecutionConfiguration,
  type ExecutionDefinition,
  type ExecutionRequest,
  type ControlledExecutor,
} from "../../src/execution/index.js";
import { generateVerificationPlan } from "../../src/planning/index.js";
import { planningFixture } from "../planning/fixture.js";

export const verifier = path.join(import.meta.dirname, "verifiers", "controlled-verifier.mjs");
export async function definition(
  mode = "pass",
  overrides: Partial<ExecutionDefinition> = {},
): Promise<ExecutionDefinition> {
  return {
    strategy: "BUILD",
    version: "fixture-1",
    executable: process.execPath,
    args: [verifier, mode],
    verifierSha256: createHash("sha256")
      .update(await readFile(verifier))
      .digest("hex"),
    workingDirectory: "WORKSPACE_ROOT",
    timeoutMs: 10000,
    maxOutputBytes: 4096,
    environmentPolicy: "MINIMAL_V1",
    protocol: "EXIT_CODE_V1",
    ...overrides,
  };
}
export async function setup(
  t: TestContext,
  mode = "pass",
  options: {
    definition?: Partial<ExecutionDefinition>;
    definitions?: readonly ExecutionDefinition[];
    files?: readonly { path: string; contents: string }[];
    optional?: boolean;
    availability?: "SUPPORTED" | "UNSUPPORTED" | "UNAVAILABLE";
    cleanup?: boolean;
  } = {},
): Promise<{ executor: ControlledExecutor; request: ExecutionRequest }> {
  const definitions = options.definitions ?? [await definition(mode, options.definition)];
  const configuration = parseExecutionConfiguration({
    schemaVersion: 7,
    version: "execution-fixture-1",
    definitions,
  });
  const fixture = planningFixture(options.optional ? ["TEST"] : ["AUTHORIZATION", "API"], {
    availability: options.availability ?? "SUPPORTED",
  });
  const planningInput = { ...fixture, configuration: configuration.identity };
  const plan = generateVerificationPlan(planningInput);
  const workspace = await prepareControlledWorkspace({
    kind: "CONTROLLED_FIXTURE",
    repository: plan.context.repository,
    baseCommit: plan.context.baseCommit,
    targetCommit: plan.context.targetCommit,
    files: options.files ?? [
      { path: "target.ts", contents: "export const value: number = 1;\n" },
      { path: "math.mjs", contents: "export const add = (a, b) => a + b;\n" },
      {
        path: "package.json",
        contents:
          '{"scripts":{"test":"REPOSITORY_SCRIPT_MUST_NOT_RUN","build":"REPOSITORY_SCRIPT_MUST_NOT_RUN"}}',
      },
    ],
  });
  if (options.cleanup !== false) t.after(async () => disposeControlledWorkspace(workspace));
  const executor = await createControlledExecutor({
    kind: "CONTROLLED_FIXTURE_ONLY",
    executables: [...new Set(definitions.map((item) => item.executable))],
    verifiers: [
      ...new Map(
        definitions.map((item) => [
          item.args[0],
          { path: item.args[0], sha256: item.verifierSha256 },
        ]),
      ).values(),
    ],
  });
  return {
    executor,
    request: { planningInput, plan, checkId: "check:build", configuration, workspace },
  };
}
