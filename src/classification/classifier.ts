import { createHash } from "node:crypto";
import {
  createChangeClassification,
  createComponentVersion,
  createRuleId,
  type ChangeClassification,
  type ChangeSet,
  type ClassificationFact,
  type ClassificationInspectionPolicy,
  type ClassificationLimitation,
} from "../domain/index.js";
import {
  readChangeContents,
  type GitChangeAnalysisInput,
  type GitProcessOptions,
  type CommitFileContent,
} from "../git/index.js";
import {
  dependencyMatches,
  pathMatches,
  semanticMatches,
  wantsContent,
  isFixture,
  type RuleMatch,
} from "./rules.js";

export const CLASSIFIER_VERSION = "3.1.0";
export interface ClassificationOptions {
  readonly inspection?: Partial<ClassificationInspectionPolicy>;
  readonly git?: GitProcessOptions;
}

/** Exact-commit adapter + deterministic rules. Does not score, plan checks, or issue verdicts. */
export async function classifyChangeSet(
  changeSet: ChangeSet,
  context: GitChangeAnalysisInput,
  options: ClassificationOptions = {},
): Promise<ChangeClassification> {
  const snapshot = await readChangeContents(
    context,
    changeSet,
    wantsContent,
    options.inspection,
    options.git,
  );
  const facts: ClassificationFact[] = [];
  const limitations: ClassificationLimitation[] = [];
  const version = createComponentVersion(CLASSIFIER_VERSION);
  for (const [fileIndex, file] of snapshot.changeSet.changedFiles.entries()) {
    const contents = snapshot.files[fileIndex];
    if (!contents) throw new Error("Missing classification snapshot file");
    const contentEffect: ClassificationFact["contentEffect"] =
      file.status === "ADDED"
        ? "ADDED"
        : file.status === "DELETED"
          ? "DELETED"
          : contents.base.blobId && contents.target.blobId
            ? contents.base.blobId === contents.target.blobId
              ? "UNCHANGED"
              : "MODIFIED"
            : "UNKNOWN";
    const add = (match: RuleMatch, side: ClassificationFact["side"]): void => {
      facts.push({
        ...match,
        ...(match.fingerprint === undefined
          ? {}
          : {
              constructDigest: `sha256:${createHash("sha256").update(match.fingerprint).digest("hex")}`,
            }),
        ruleId: createRuleId(match.ruleId),
        ruleVersion: version,
        fileIndex,
        side,
        contentEffect,
      });
    };
    for (const [side, path, content] of [
      ["BASE", file.previousPath ?? file.path, contents.base],
      ["TARGET", file.path, contents.target],
    ] as const) {
      if (content.state === "ABSENT") continue;
      for (const match of pathMatches(path)) add(match, side);
      if (content.state !== "TEXT" && (content.state !== "NOT_REQUESTED" || wantsContent(path)))
        limitations.push({
          fileIndex,
          side,
          code: content.state === "NOT_REQUESTED" ? "CONTENT_WITHHELD" : content.state,
        });
    }
    const inspected = [
      contents.base.state === "TEXT"
        ? semanticMatches(contents.base.text ?? "", file.previousPath ?? file.path)
        : { matches: [] },
      contents.target.state === "TEXT"
        ? semanticMatches(contents.target.text ?? "", file.path)
        : { matches: [] },
    ] as const;
    for (const [position, side] of [
      [0, "BASE"],
      [1, "TARGET"],
    ] as const) {
      const limit = inspected[position].limitation;
      if (limit) limitations.push({ fileIndex, side, code: limit });
    }
    const comparable =
      [contents.base, contents.target].every(
        (part) => part.state === "TEXT" || part.state === "ABSENT",
      ) && inspected.every((part) => !part.limitation);
    if (comparable) {
      for (const [position, side] of [
        [0, "BASE"],
        [1, "TARGET"],
      ] as const) {
        const counterpart = new Map<string, number>();
        for (const match of inspected[position === 0 ? 1 : 0].matches) {
          const key = JSON.stringify([match.ruleId, match.fingerprint]);
          counterpart.set(key, (counterpart.get(key) ?? 0) + 1);
        }
        for (const match of inspected[position].matches) {
          const key = JSON.stringify([match.ruleId, match.fingerprint]);
          const count = counterpart.get(key) ?? 0;
          if (count > 0) counterpart.set(key, count - 1);
          else add(match, side);
        }
      }
    } else if (wantsContent(file.path) || wantsContent(file.previousPath ?? file.path))
      limitations.push({ fileIndex, side: "BOTH", code: "SEMANTIC_COMPARISON_UNAVAILABLE" });
    if (isFixture(file.path) || isFixture(file.previousPath ?? file.path))
      limitations.push({ fileIndex, side: "BOTH", code: "FIXTURE_SEMANTICS_EXCLUDED" });
    if (
      [file.path, file.previousPath].some(
        (path) => path !== undefined && /(?:^|\/)package\.json$/u.test(path),
      )
    ) {
      const available = (content: CommitFileContent): boolean =>
        content.state === "TEXT" || content.state === "ABSENT";
      if (isFixture(file.path) || isFixture(file.previousPath ?? file.path)) {
        // Explicit fixture inputs are examples, not production dependency declarations.
      } else if (available(contents.base) && available(contents.target)) {
        const compared = dependencyMatches(
          contents.base.text ?? null,
          contents.target.text ?? null,
        );
        for (const match of compared.matches) add(match, "BOTH");
        if (compared.limitation)
          limitations.push({ fileIndex, side: "BOTH", code: compared.limitation });
      } else
        limitations.push({ fileIndex, side: "BOTH", code: "DEPENDENCY_COMPARISON_UNAVAILABLE" });
    }
    if (!facts.some((fact) => fact.fileIndex === fileIndex))
      limitations.push({ fileIndex, side: "BOTH", code: "NO_SUPPORTED_RULE" });
  }
  if (facts.length === 0)
    facts.push({
      category: "GENERAL",
      ruleId: createRuleId("fallback.general"),
      ruleVersion: version,
      fileIndex: null,
      side: "CHANGE_SET",
      contentEffect: "UNKNOWN",
      signal: "no specific supported evidence",
      observation:
        snapshot.changeSet.fileCount === 0
          ? "Exact commits have no changed files"
          : "No specific supported category established; inspect limitations. This is not a safety assessment",
      line: null,
    });
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  facts.sort((a, b) =>
    compare(
      JSON.stringify([a.fileIndex, a.ruleId, a.side, a.signal, a.line]),
      JSON.stringify([b.fileIndex, b.ruleId, b.side, b.signal, b.line]),
    ),
  );
  limitations.sort((a, b) =>
    compare(
      JSON.stringify([a.fileIndex, a.side, a.code]),
      JSON.stringify([b.fileIndex, b.side, b.code]),
    ),
  );
  return createChangeClassification({
    changeSet: snapshot.changeSet,
    classifierVersion: version,
    inspectionPolicy: snapshot.policy,
    facts,
    limitations,
  });
}
