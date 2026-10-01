import assert from "node:assert/strict";
import test from "node:test";
import {
  dependencyMatches,
  pathMatches,
  semanticMatches,
  wantsContent,
} from "../../src/classification/rules.js";
import { inspectSyntax } from "../../src/classification/syntax.js";

const cases: readonly [string, string, readonly string[]][] = [
  [
    "src/login.ts",
    'import jwt from "jsonwebtoken"; export function login(token: string) { return jwt.verify(token, key); }',
    ["AUTHENTICATION"],
  ],
  [
    "src/guard.ts",
    'export function requireAdmin(req, res, next) { if (req.user.role !== "admin") return res.status(403).end(); next(); }',
    ["AUTHORIZATION"],
  ],
  [
    "src/permissions.ts",
    'export function guard(req, res) { if (!req.user.permissions.includes("write")) return res.status(403).end(); }',
    ["AUTHORIZATION"],
  ],
  [
    "src/api/users.ts",
    'import express from "express"; const app = express(); app.get("/users", (req,res) => res.json([]));',
    ["API"],
  ],
  ["src/app/users/route.ts", "export async function GET() { return Response.json([]); }", ["API"]],
  ["src/Button.tsx", "export function Button() { return <button>Save</button>; }", ["FRONTEND"]],
  [
    "src/authentication.ts",
    'export const color = "login authorization roles password jwt.verify(token)";',
    [],
  ],
  [
    "src/api/fake.ts",
    '// import express from "express"; app.get("/", handler);\nexport const example = `jwt.verify(token)`;',
    [],
  ],
  ["src/api.ts", 'const app = new Map(); app.get("/example");', []],
  ["src/utils/testValue.ts", "export const testValue = 42;", []],
  ["src/authorization.ts", 'export const permission = "admin";', []],
  [
    "src/shadow.ts",
    'import jwt from "jsonwebtoken"; function demo(jwt) { return jwt.verify("example"); }',
    [],
  ],
  ["src/reassigned.ts", 'import jwt from "jsonwebtoken"; jwt = fake; jwt.verify(token);', []],
  ["src/type-only.ts", 'import type jwt from "jsonwebtoken"; jwt.verify(token);', []],
];
for (const [path, source, categories] of cases) {
  void test(`structural calibration: ${path}`, () => {
    const result = semanticMatches(source, path);
    assert.deepEqual(
      [...new Set(result.matches.map((match) => match.category))].sort(),
      [...categories].sort(),
    );
    for (const match of result.matches) assert.ok(match.line !== null && match.line > 0);
  });
}
void test("path rules are explicit conventions, not keyword matches", () => {
  for (const [path, expected] of [
    ["src/styles/login-page.css", ["FRONTEND"]],
    ["notes/database-design.md", []],
    ["src/utils/testValue.ts", []],
    ["test/users.test.ts", ["TEST"]],
    ["src/a.spec.ts", ["TEST"]],
    ["vitest.config.ts", ["TEST"]],
    ["migrations/001.sql", ["DATABASE"]],
    ["prisma/schema.prisma", ["DATABASE"]],
    ["tsconfig.json", ["CONFIGURATION"]],
    [".env.production", ["CONFIGURATION"]],
    [".github/workflows/ci.yml", ["CONFIGURATION"]],
    ["package-lock.json", ["DEPENDENCY"]],
    ["README.md", []],
  ] as const)
    assert.deepEqual(
      pathMatches(path).map((match) => match.category),
      expected,
      path,
    );
  assert.equal(wantsContent(".env.production.ts"), false);
  assert.equal(wantsContent(".env/private.ts"), false);
});
void test("dependency sections are compared, not package metadata", () => {
  const manifest = (value: unknown): string => JSON.stringify(value);
  assert.deepEqual(
    dependencyMatches(manifest({ version: "1" }), manifest({ version: "2" })).matches,
    [],
  );
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const [before, after, word] of [
      [{}, { express: "1" }, "1 added"],
      [{ express: "1" }, {}, "1 removed"],
      [{ express: "1" }, { express: "2" }, "1 versions changed"],
    ] as const) {
      const result = dependencyMatches(
        manifest({ [section]: before }),
        manifest({ [section]: after }),
      );
      assert.equal(result.matches[0]?.category, "DEPENDENCY");
      assert.ok(result.matches[0]?.observation.includes(word));
    }
  }
  assert.equal(dependencyMatches(null, '{"dependencies":{"x":"1"}}').matches.length, 1);
  assert.equal(dependencyMatches('{"dependencies":{"x":"1"}}', null).matches.length, 1);
  assert.equal(dependencyMatches("{", "{}").limitation, "MALFORMED_MANIFEST");
  assert.equal(
    dependencyMatches('{"dependencies":{"x":1}}', "{}").limitation,
    "MALFORMED_MANIFEST",
  );
});
void test("malformed and deeply nested syntax cannot produce semantic facts", () => {
  assert.equal(
    inspectSyntax('import jwt from "jsonwebtoken"; jwt.verify(', "auth.ts").limitation,
    "MALFORMED_SOURCE",
  );
  assert.equal(
    inspectSyntax(`${"(".repeat(200)}1${")".repeat(200)}`, "x.ts").limitation,
    "SYNTAX_LIMIT",
  );
});
void test("OpenAPI needs actual structural endpoint evidence", () => {
  assert.equal(
    semanticMatches(
      '{"openapi":"3.0.0","info":{"title":"API","version":"1"},"paths":{"/users":{"get":{"responses":{"200":{"description":"ok"}}}}}}',
      "openapi.json",
    ).matches[0]?.category,
    "API",
  );
  assert.equal(semanticMatches('{"description":"API"}', "openapi.json").matches.length, 0);
});
