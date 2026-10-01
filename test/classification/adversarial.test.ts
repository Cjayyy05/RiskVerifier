import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { semanticMatches, dependencyMatches, pathMatches } from "../../src/classification/rules.js";
import {
  hasSyntaxErrors,
  inspectSyntax,
  syntaxFingerprint,
} from "../../src/classification/syntax.js";
import {
  createChangeClassification,
  createChangedFile,
  createChangeSet,
  createComponentVersion,
  createRuleId,
  InvalidInputError,
  InvariantViolationError,
  type ClassificationFact,
} from "../../src/domain/index.js";

const categories = (text: string, file = "source.ts"): readonly string[] =>
  [...new Set(semanticMatches(text, file).matches.map((match) => match.category))].sort();
const positive: readonly [string, string, readonly string[]][] = [
  [
    "credential alias",
    'import {compare as checkPassword} from "bcrypt"; checkPassword(password,hash);',
    ["AUTHENTICATION"],
  ],
  ["password hashing", 'import argon from "argon2"; argon.hash(password);', ["AUTHENTICATION"]],
  [
    "bearer verification",
    'import {jwtVerify as checkUser} from "jose"; checkUser(req.headers.authorization,key);',
    ["AUTHENTICATION"],
  ],
  [
    "refresh token",
    'import jwt from "jsonwebtoken"; jwt.sign(refreshClaims,key);',
    ["AUTHENTICATION"],
  ],
  [
    "authentication middleware",
    'import passport from "passport"; passport.authenticate("session");',
    ["AUTHENTICATION"],
  ],
  [
    "401 authorization",
    'export function guard(req,res){if(req.user.role!=="admin") return res.status(401).end();}',
    ["AUTHORIZATION"],
  ],
  [
    "hidden resource",
    'export function guard(req,res){if(!req.user.permissions.includes("read")) return res.status(404).end();}',
    ["AUTHORIZATION"],
  ],
  [
    "throw forbidden",
    'import {ForbiddenException as Denied} from "@nestjs/common"; export function guard(req){if(req.user.role!=="admin") throw new Denied();}',
    ["AUTHORIZATION"],
  ],
  [
    "next error",
    'import {ForbiddenException} from "@nestjs/common"; export function guard(req,res,next){if(req.user.role!=="admin") next(new ForbiddenException());}',
    ["AUTHORIZATION"],
  ],
  [
    "authn authz separate",
    'import jwt from "jsonwebtoken"; export function guard(req,res){jwt.verify(req.token,key); if(req.user.role!=="admin") return res.status(403).end();}',
    ["AUTHENTICATION", "AUTHORIZATION"],
  ],
  [
    "Fastify route",
    'import fastify from "fastify"; const app=fastify(); app.post("/",handler);',
    ["API"],
  ],
  [
    "router alias",
    'import {Router as Factory} from "express"; const original=Factory(); const router=original; router.get("/",handler);',
    ["API"],
  ],
  [
    "chained route",
    'import express from "express"; const app=express(); app.route("/users").get(handler);',
    ["API"],
  ],
  [
    "static template path",
    'import express from "express"; const app=express(); app.get(`/users`,handler);',
    ["API"],
  ],
];
for (const [name, source, expected] of positive)
  void test(`adversarial supported: ${name}`, () => assert.deepEqual(categories(source), expected));

const negative: readonly [string, string][] = [
  ["authorization-notes.ts", '// check admin permission\nconst message="403 forbidden";'],
  ["apiHelper.ts", 'const obj={post(x){return x}}; obj.post("/route"); fetch("/api/users");'],
  ["configValue.ts", "export const configValue=1;"],
  ["testValue.ts", "export const testValue=1;"],
  ["tokenColors.ts", 'const bearerToken="blue";'],
  ["latest.ts", "export const latest=1;"],
  ["contest.ts", "export const contest=1;"],
  ["production/testHelpers/value.ts", 'import {test} from "./utility"; test();'],
  ["crypto.ts", 'import {createHash} from "node:crypto"; createHash("sha256").update(data);'],
  [
    "unusedCallback.ts",
    "export function sample(req,res){if(req.user.role){const unused=()=>res.status(403);}}",
  ],
  ["fixtures/example.ts", 'import jwt from "jsonwebtoken"; jwt.verify(token,key);'],
];
for (const [file, source] of negative)
  void test(`adversarial false positive: ${file}`, () =>
    assert.deepEqual(categories(source, file), []));

const unsupported: readonly [string, string][] = [
  ["custom auth", 'import {verifyToken as checkUser} from "./auth"; checkUser(token);'],
  [
    "session cookie",
    'export function session(req,res){req.session.user=req.user;res.cookie("session",id);}',
  ],
  ["boolean RBAC helper", 'export function canAccess(user){return user.role==="admin";}'],
  [
    "helper indirection",
    'function canAccess(user){return user.role==="admin";} export function guard(req,res){if(!canAccess(req.user)) return res.status(403).end();}',
  ],
  [
    "imported predicate",
    'import {hasPermission} from "./permissions"; if(!hasPermission(user,"read")) throw Error();',
  ],
  ["custom decorator", "@Controller() class Example { @Guard() get(){} }"],
  [
    "dynamic route",
    'import express from "express"; const app=express(); app.get(pathFromConfig(),handler);',
  ],
  ["custom ORM", "store.defineModel({role:String});"],
];
for (const [name, source] of unsupported)
  void test(`documented false-negative boundary: ${name}`, () =>
    assert.deepEqual(categories(source), []));

void test("UI, test and path conventions do not imply identity or permission behavior", () => {
  assert.deepEqual(
    pathMatches("authentication-theme.css").map((match) => match.category),
    ["FRONTEND"],
  );
  assert.deepEqual(pathMatches("database-design.md"), []);
  assert.deepEqual(
    categories("export const Admin=()=> <button>admin</button>;", "adminButton.tsx"),
    ["FRONTEND"],
  );
  assert.deepEqual(categories("export const value=1;", "server.tsx"), []);
  assert.deepEqual(categories("export const UI=()=> <div/>;", "server.tsx"), ["FRONTEND"]);
  assert.deepEqual(
    pathMatches("fixtures/tsconfig.json").map((match) => match.category),
    ["TEST"],
  );
  assert.deepEqual(pathMatches("database/fixture.sql"), []);
});

void test("JSON duplicates including escaped equivalents are rejected", () => {
  for (const text of [
    '{"dependencies":{"a":"1"},"dependencies":{}}',
    '{"dependencies":{"a":"1","\\u0061":"2"}}',
  ]) {
    assert.equal(dependencyMatches("{}", text).limitation, "MALFORMED_MANIFEST");
    assert.deepEqual(dependencyMatches("{}", text).matches, []);
  }
  for (const text of [
    '{"openapi":"nonsense","paths":{"/x":{"get":{}}}}',
    '{"openapi":"3.0.0","openapi":"3.1.0","paths":{}}',
    '{"paths":{"/x":{"get":{}}}}',
  ])
    assert.equal(semanticMatches(text, "openapi.json").matches.length, 0);
  for (const text of [
    '{"version":"2","scripts":{"test":"new"}}',
    ' { "dependencies": {"b":"2","a":"1"}, "description":"new" } ',
  ]) {
    const before = text.includes("dependencies")
      ? '{"dependencies":{"a":"1","b":"2"}}'
      : '{"version":"1","scripts":{"test":"old"}}';
    assert.deepEqual(dependencyMatches(before, text).matches, []);
  }
});

void test("pinned parser exposes diagnostics without a compiler program; bounded syntax fails honestly", () => {
  assert.equal(ts.version, "6.0.3");
  assert.equal(
    hasSyntaxErrors(ts.createSourceFile("x.ts", "let x = ;", ts.ScriptTarget.Latest, true)),
    true,
  );
  assert.equal(
    hasSyntaxErrors(ts.createSourceFile("x.ts", "const x = 1;", ts.ScriptTarget.Latest, true)),
    false,
  );
  const before = ts.createSourceFile("x.ts", "const x=1;", ts.ScriptTarget.Latest, true);
  const after = ts.createSourceFile(
    "x.ts",
    "//comment\nconst x = 1;",
    ts.ScriptTarget.Latest,
    true,
  );
  assert.equal(syntaxFingerprint(before), syntaxFingerprint(after));
  assert.notEqual(
    syntaxFingerprint(
      ts.createSourceFile("x.ts", "verify(`prefix${token}`,1n);", ts.ScriptTarget.Latest, true),
    ),
    syntaxFingerprint(
      ts.createSourceFile("x.ts", "verify(`changed${token}`,2n);", ts.ScriptTarget.Latest, true),
    ),
  );
  assert.equal(inspectSyntax("x".repeat(1048577), "x.ts").limitation, "SYNTAX_LIMIT");
  assert.equal(
    inspectSyntax("(".repeat(200) + "x" + ")".repeat(200), "x.ts").limitation,
    "SYNTAX_LIMIT",
  );
});

void test("intermediate factory rejects forged sides, effects, accessors, sparse and malformed data", () => {
  const changeSet = createChangeSet({
    repository: "repo",
    baseCommit: "a".repeat(40),
    targetCommit: "b".repeat(40),
    analyzerVersion: "2.1.0",
    changedFiles: [
      createChangedFile({
        path: "x.ts",
        status: "ADDED",
        isBinary: false,
        additions: 1,
        deletions: 0,
      }),
    ],
  });
  const fact: ClassificationFact = {
    category: "API",
    ruleId: createRuleId("syntax.api"),
    ruleVersion: createComponentVersion("3.1.0"),
    fileIndex: 0,
    side: "TARGET",
    contentEffect: "ADDED",
    signal: "route",
    observation: "added route",
    line: 1,
  };
  const input = {
    changeSet,
    classifierVersion: "3.1.0",
    inspectionPolicy: { maxFileBytes: 1, maxTotalBytes: 1, maxFiles: 1 },
    facts: [fact],
    limitations: [],
  };
  for (const override of [
    { side: "BASE" },
    { contentEffect: "DELETED" },
    { side: "BOTH", line: 1 },
  ])
    assert.throws(
      () =>
        createChangeClassification({
          ...input,
          facts: [{ ...fact, ...override } as ClassificationFact],
        }),
      InvariantViolationError,
    );
  let getterRan = false;
  const accessor = Object.defineProperty({ ...fact }, "category", {
    get: () => {
      getterRan = true;
      return "API";
    },
  });
  for (const invalid of [
    null,
    { ...input, facts: [null] },
    { ...input, facts: new Array(1) },
    { ...input, facts: [accessor] },
    { ...input, limitations: {} },
  ])
    assert.throws(() => createChangeClassification(invalid as never), InvalidInputError);
  assert.equal(getterRan, false);
  const result = createChangeClassification(input);
  assert.ok(Object.isFrozen(result.facts[0]));
});
