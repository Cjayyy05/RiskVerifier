import type { ChangeCategory } from "../domain/index.js";
import { inspectSyntax, parseStructuredJson, canonicalJson } from "./syntax.js";

export interface RuleMatch {
  readonly category: ChangeCategory;
  readonly ruleId: string;
  readonly signal: string;
  readonly observation: string;
  readonly line: number | null;
  readonly fingerprint?: string;
}
export interface PathRule {
  readonly id: string;
  readonly category: ChangeCategory;
  readonly description: string;
  readonly matches: (path: string) => boolean;
}
export const PATH_RULES: readonly PathRule[] = Object.freeze([
  {
    id: "path.fixture",
    category: "TEST",
    description: "Explicit fixture directory; production semantics excluded",
    matches: isFixture,
  },
  {
    id: "path.test",
    category: "TEST",
    description: "Supported test directory/naming convention or test-runner configuration",
    matches: (path) =>
      /(?:^|\/)(?:__tests__|tests?|spec)\/.*\.[cm]?[jt]sx?$/u.test(path) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) ||
      /(?:^|\/)(?:vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s$/u.test(path),
  },
  {
    id: "path.database",
    category: "DATABASE",
    description: "SQL migration or supported Prisma schema path",
    matches: (path) =>
      /(?:^|\/)migrations\/.*\.sql$/u.test(path) || /(?:^|\/)prisma\/.*\.prisma$/u.test(path),
  },
  {
    id: "path.configuration",
    category: "CONFIGURATION",
    description:
      "Supported Node/TypeScript, build, environment, or workflow configuration path (no secret contents inspected)",
    matches: (path) =>
      /(?:^|\/)(?:tsconfig(?:\.[^/]+)?\.json|(?:vite|next|webpack|rollup|eslint)\.config\.[cm]?[jt]s|\.env(?:\.[^/]+)?|\.npmrc|\.nvmrc)$/u.test(
        path,
      ) || /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path),
  },
  {
    id: "path.frontend",
    category: "FRONTEND",
    description: "Stylesheet source path",
    matches: (path) => /\.(?:css|scss|sass|less)$/u.test(path),
  },
  {
    id: "path.lockfile",
    category: "DEPENDENCY",
    description: "Supported dependency lockfile path changed; lockfile semantics not verified",
    matches: (path) =>
      /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/u.test(path),
  },
]);

export function pathMatches(path: string): readonly RuleMatch[] {
  return PATH_RULES.filter(
    (rule) =>
      rule.matches(path) &&
      (!isFixture(path) || rule.category === "TEST" || rule.category === "FRONTEND"),
  ).map((rule) => ({
    category: rule.category,
    ruleId: rule.id,
    signal: rule.id,
    observation: rule.description,
    line: null,
  }));
}
export function isFixture(path: string): boolean {
  return /(?:^|\/)(?:fixtures|__fixtures__)(?:\/|$)/u.test(path);
}
export function wantsContent(path: string): boolean {
  // Runtime secret files are never read, including misleading source suffixes.
  if (path.split("/").some((part) => part === ".env" || part.startsWith(".env."))) return false;
  return (
    /\.[cm]?[jt]sx?$/u.test(path) ||
    /(?:^|\/)package\.json$/u.test(path) ||
    /(?:^|\/)(?:openapi|swagger)\.json$/u.test(path)
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function semanticMatches(
  text: string,
  path: string,
): { readonly matches: readonly RuleMatch[]; readonly limitation?: string } {
  if (/\.[cm]?[jt]sx?$/u.test(path)) {
    const inspected = inspectSyntax(text, path);
    return {
      matches: inspected.signals
        .filter((signal) => !isFixture(path) || signal.category === "FRONTEND")
        .map((signal) => ({
          ...signal,
          ruleId: `syntax.${signal.category.toLowerCase()}`,
          observation: `Added or removed structural construct: ${signal.signal}; not proof of runtime behavior`,
        })),
      ...(inspected.limitation ? { limitation: inspected.limitation } : {}),
    };
  }
  if (/(?:^|\/)(?:openapi|swagger)\.json$/u.test(path)) {
    try {
      const value: unknown = parseStructuredJson(text);
      if (
        !record(value) ||
        !(
          (typeof value.openapi === "string" && /^3\.[01]\.\d+$/u.test(value.openapi)) ||
          value.swagger === "2.0"
        ) ||
        !record(value.info) ||
        typeof value.info.title !== "string" ||
        typeof value.info.version !== "string" ||
        !record(value.paths)
      )
        return { matches: [], limitation: "MALFORMED_API_SPEC" };
      const endpoint = Object.entries(value.paths).some(
        ([key, entry]) =>
          key.startsWith("/") &&
          record(entry) &&
          Object.entries(entry).some(
            ([method, definition]) =>
              ["get", "post", "put", "patch", "delete", "head", "options"].includes(method) &&
              record(definition) &&
              record(definition.responses) &&
              Object.keys(definition.responses).some((status) =>
                /^(?:[1-5][0-9X]{2}|default)$/u.test(status),
              ),
          ),
      );
      return {
        matches:
          endpoint && !isFixture(path)
            ? [
                {
                  category: "API",
                  ruleId: "json.api",
                  signal: "OpenAPI endpoint object",
                  observation:
                    "Supported API specification contains an HTTP endpoint object; schema validity is not verified",
                  line: null,
                  fingerprint: canonicalJson({
                    version: value.openapi ?? value.swagger,
                    paths: value.paths,
                  }),
                },
              ]
            : [],
      };
    } catch {
      return { matches: [], limitation: "MALFORMED_API_SPEC" };
    }
  }
  return { matches: [] };
}

const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
function dependencyMap(text: string | null): Map<string, string> {
  const result = new Map<string, string>();
  if (text === null) return result;
  const value: unknown = parseStructuredJson(text);
  if (!record(value)) throw new Error("Malformed manifest");
  for (const section of SECTIONS) {
    const entries = value[section];
    if (entries === undefined) continue;
    if (!record(entries)) throw new Error("Malformed dependency section");
    for (const [name, version] of Object.entries(entries)) {
      if (typeof version !== "string" || name.length === 0)
        throw new Error("Malformed dependency entry");
      result.set(JSON.stringify([section, name]), version);
    }
  }
  return result;
}
export function dependencyMatches(
  base: string | null,
  target: string | null,
): { readonly matches: readonly RuleMatch[]; readonly limitation?: string } {
  let before: Map<string, string>;
  let after: Map<string, string>;
  try {
    before = dependencyMap(base);
    after = dependencyMap(target);
  } catch {
    return { matches: [], limitation: "MALFORMED_MANIFEST" };
  }
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((key) => before.get(key) !== after.get(key));
  // One bounded summary per manifest, not potentially thousands of secret-bearing values.
  if (changed.length === 0) return { matches: [] };
  const added = changed.filter((key) => !before.has(key)).length;
  const removed = changed.filter((key) => !after.has(key)).length;
  return {
    matches: [
      {
        category: "DEPENDENCY",
        ruleId: "json.dependencies",
        signal: "dependency-section delta",
        observation: `Exact manifest dependency entries changed: ${added} added, ${removed} removed, ${changed.length - added - removed} versions changed across dependencies/devDependencies/peerDependencies/optionalDependencies; values withheld`,
        line: null,
      },
    ],
  };
}
