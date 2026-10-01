import ts from "typescript";
import { createHash } from "node:crypto";
import type { ChangeCategory } from "../domain/index.js";

export interface SyntaxSignal {
  readonly category: ChangeCategory;
  readonly signal: string;
  readonly line: number;
  /** Internal comparison key; never retained in result evidence (may contain source literals). */
  readonly fingerprint: string;
}
export interface SyntaxInspection {
  readonly signals: readonly SyntaxSignal[];
  readonly limitation?: string;
}

function children(node: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    result.push(child);
  });
  return result;
}
function allNodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  const pending: { node: ts.Node; depth: number }[] = [{ node: root, depth: 0 }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    if (item.depth > 128 || result.length >= 50000) throw new RangeError("AST inspection limit");
    result.push(item.node);
    for (const child of children(item.node)) pending.push({ node: child, depth: item.depth + 1 });
  }
  return result;
}
export function hasSyntaxErrors(source: ts.SourceFile): boolean {
  // Pinned TypeScript parser contract: not public in the .d.ts, so validate at runtime.
  // Never construct a Program/host, resolve modules, emit, or fall back to project tooling.
  const diagnostics: unknown = Reflect.get(source, "parseDiagnostics");
  if (!Array.isArray(diagnostics))
    throw new Error("Unsupported TypeScript parser diagnostics contract");
  return diagnostics.length !== 0;
}

export function syntaxFingerprint(node: ts.Node): string {
  const encode = (part: ts.Node): unknown => [
    part.kind,
    ts.isIdentifier(part) ||
    ts.isLiteralExpression(part) ||
    ts.isTemplateLiteralToken(part) ||
    ts.isJsxText(part)
      ? part.text
      : null,
    children(part).map(encode),
  ];
  return createHash("sha256")
    .update(JSON.stringify(encode(node)))
    .digest("hex");
}

export function boundedSource(text: string, name: string): ts.SourceFile {
  if (text.length > 1048576) throw new RangeError("Source limit");
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  allNodes(source);
  return source;
}

export function parseStructuredJson(text: string): unknown {
  if (text.length > 1048576) throw new RangeError("JSON limit");
  // JSON.parse enforces JSON grammar; TypeScript supplies bounded object-member locations.
  const value: unknown = JSON.parse(text);
  const source = ts.parseJsonText("input.json", text);
  const nodes = allNodes(source);
  if (hasSyntaxErrors(source)) throw new Error("Malformed JSON");
  for (const node of nodes)
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name))
          throw new Error("Malformed JSON member");
        if (keys.has(property.name.text)) throw new Error("Duplicate JSON member");
        keys.add(property.name.text);
      }
    }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function chain(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const parent = chain(node.expression);
    return parent === undefined ? undefined : `${parent}.${node.name.text}`;
  }
  return undefined;
}
function nearestFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    )
      return current;
    current = current.parent;
  }
  return undefined;
}

/** Syntactic module-role inspection, not control-flow or behavioral verification. */
export function inspectSyntax(text: string, filePath: string): SyntaxInspection {
  try {
    if (text.length > 1048576) return { signals: [], limitation: "SYNTAX_LIMIT" };
    // Reject deep token nesting before invoking the recursive parser. Comments/strings are tokens.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
    let depth = 0;
    let tokens = 0;
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (++tokens > 50000) return { signals: [], limitation: "SYNTAX_LIMIT" };
      if (
        [
          ts.SyntaxKind.OpenBraceToken,
          ts.SyntaxKind.OpenBracketToken,
          ts.SyntaxKind.OpenParenToken,
        ].includes(kind)
      )
        depth++;
      if (
        [
          ts.SyntaxKind.CloseBraceToken,
          ts.SyntaxKind.CloseBracketToken,
          ts.SyntaxKind.CloseParenToken,
        ].includes(kind)
      )
        depth--;
      if (depth > 128) return { signals: [], limitation: "SYNTAX_LIMIT" };
    }
    const source = boundedSource(text, /\.[jt]sx$/u.test(filePath) ? "input.tsx" : "input.ts");
    const nodes = allNodes(source);
    if (hasSyntaxErrors(source)) return { signals: [], limitation: "MALFORMED_SOURCE" };
    const declarations = new Map<string, number>();
    const mutated = new Set<string>();
    const declare = (name: ts.BindingName | ts.Identifier): void => {
      if (ts.isIdentifier(name))
        declarations.set(name.text, (declarations.get(name.text) ?? 0) + 1);
      else
        for (const element of name.elements)
          if (ts.isBindingElement(element)) declare(element.name);
    };
    for (const node of nodes) {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
        declare(node.name);
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node) ||
          ts.isClassExpression(node)) &&
        node.name
      )
        declare(node.name);
      if (ts.isImportClause(node) && node.name) declare(node.name);
      if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) declare(node.name);
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ) {
        const root = chain(node.left)?.split(".")[0];
        if (root) mutated.add(root);
      }
    }
    const stable = (name: string): boolean => declarations.get(name) === 1 && !mutated.has(name);
    const bindings = new Map<string, string>();
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.importClause?.isTypeOnly
      )
        continue;
      const module = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name && stable(clause.name.text))
        bindings.set(clause.name.text, `${module}.default`);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named) && stable(named.name.text))
        bindings.set(named.name.text, `${module}.default`);
      if (named && ts.isNamedImports(named))
        for (const item of named.elements) {
          if (!item.isTypeOnly && stable(item.name.text))
            bindings.set(item.name.text, `${module}.${item.propertyName?.text ?? item.name.text}`);
        }
    }
    const resolve = (expression: ts.Expression): string | undefined => {
      const name = chain(expression);
      if (!name) return undefined;
      const [root, ...tail] = name.split(".");
      const binding = bindings.get(root ?? "");
      return binding ? [binding, ...tail].join(".").replace(".default.", ".") : undefined;
    };
    const routers = new Set<string>();
    for (const node of nodes) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        stable(node.name.text) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ["express.default", "express.Router", "fastify.default"].includes(
          resolve(node.initializer.expression) ?? "",
        )
      )
        routers.add(node.name.text);
    }
    for (let pass = 0; pass < 8; pass++)
      for (const node of nodes) {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          stable(node.name.text) &&
          node.initializer &&
          ts.isIdentifier(node.initializer) &&
          routers.has(node.initializer.text)
        )
          routers.add(node.name.text);
      }
    const signals: SyntaxSignal[] = [];
    const add = (
      category: ChangeCategory,
      signal: string,
      node: ts.Node,
      identity = "",
      relevant: ts.Node = node,
    ): void => {
      if (signals.length >= 512) throw new RangeError("Signal limit");
      const controls: string[] = [];
      let parent = node.parent;
      while (parent && !ts.isSourceFile(parent)) {
        if (ts.isIfStatement(parent)) controls.push(syntaxFingerprint(parent.expression));
        if (ts.isConditionalExpression(parent)) controls.push(syntaxFingerprint(parent.condition));
        parent = parent.parent;
      }
      signals.push({
        category,
        signal,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        fingerprint: JSON.stringify([identity, syntaxFingerprint(relevant), controls]),
      });
    };
    // Source-order traversal determines the first evidence location, not AST stack order.
    for (const node of [...nodes].sort((a, b) => a.pos - b.pos)) {
      if (ts.isCallExpression(node)) {
        const binding = resolve(node.expression);
        if (
          [
            "jsonwebtoken.verify",
            "jsonwebtoken.sign",
            "jose.jwtVerify",
            "passport.authenticate",
            "passport.default.authenticate",
            "argon2.verify",
            "bcrypt.compare",
            "bcryptjs.compare",
            "bcrypt.hash",
            "bcryptjs.hash",
            "argon2.hash",
          ].includes(binding ?? "")
        )
          add("AUTHENTICATION", "import-bound credential/token operation", node, binding);
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          routers.has(node.expression.expression.text) &&
          ["get", "post", "put", "patch", "delete", "options", "head", "all"].includes(
            node.expression.name.text,
          ) &&
          node.arguments.length >= 2 &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])
        )
          add("API", "import-bound HTTP route registration", node);
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ["get", "post", "put", "patch", "delete", "head", "options"].includes(
            node.expression.name.text,
          ) &&
          ts.isCallExpression(node.expression.expression)
        ) {
          const route = node.expression.expression;
          if (
            ts.isPropertyAccessExpression(route.expression) &&
            route.expression.name.text === "route" &&
            ts.isIdentifier(route.expression.expression) &&
            routers.has(route.expression.expression.text) &&
            route.arguments[0] &&
            ts.isStringLiteralLike(route.arguments[0]) &&
            node.arguments.length > 0
          )
            add("API", "import-bound chained HTTP route registration", node);
        }
      }
      if (ts.isIfStatement(node)) {
        const fn = nearestFunction(node);
        const parameters =
          fn?.parameters.map((parameter) =>
            ts.isIdentifier(parameter.name) ? parameter.name.text : "",
          ) ?? [];
        const roles = allNodes(node.expression).some((part) => {
          const value = chain(part);
          return (
            value !== undefined &&
            parameters.some(
              (name) =>
                name !== "" &&
                [`${name}.user.role`, `${name}.user.roles`, `${name}.user.permissions`].includes(
                  value,
                ),
            )
          );
        });
        const denialKeys: string[] = [];
        const denies = [node.thenStatement, node.elseStatement]
          .map(
            (branch, branchIndex) =>
              branch &&
              allNodes(branch)
                .map(
                  (part) =>
                    nearestFunction(part) === fn &&
                    ts.isCallExpression(part) &&
                    ts.isPropertyAccessExpression(part.expression) &&
                    ts.isIdentifier(part.expression.expression) &&
                    parameters.includes(part.expression.expression.text) &&
                    part.expression.name.text === "status" &&
                    part.arguments[0] &&
                    ts.isNumericLiteral(part.arguments[0]) &&
                    ["401", "403", "404"].includes(part.arguments[0].text) &&
                    denialKeys.push(`${branchIndex}:${syntaxFingerprint(part)}`) > 0,
                )
                .some(Boolean),
          )
          .some(Boolean);
        const throwsForbidden = [node.thenStatement, node.elseStatement]
          .map(
            (branch, branchIndex) =>
              branch &&
              allNodes(branch)
                .map((part) => {
                  if (nearestFunction(part) !== fn || !ts.isNewExpression(part)) return false;
                  const binding = resolve(part.expression);
                  if (
                    binding !== "@nestjs/common.ForbiddenException" &&
                    binding !== "@nestjs/common.UnauthorizedException"
                  )
                    return false;
                  const supported =
                    ts.isThrowStatement(part.parent) ||
                    (ts.isCallExpression(part.parent) &&
                      ts.isIdentifier(part.parent.expression) &&
                      parameters.includes(part.parent.expression.text));
                  if (supported)
                    denialKeys.push(`${branchIndex}:${binding}:${syntaxFingerprint(part.parent)}`);
                  return supported;
                })
                .some(Boolean),
          )
          .some(Boolean);
        if (roles && (denies || throwsForbidden))
          add(
            "AUTHORIZATION",
            "request-user role/permission condition with explicit denial branch",
            node,
            JSON.stringify(denialKeys.sort()),
            node.expression,
          );
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        /(?:^|\/)app\/(?:.*\/)?route\.[cm]?[jt]s$/u.test(filePath) &&
        ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(node.name.text) &&
        node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      )
        add("API", "Next app route exported HTTP handler", node);
      if (
        /\.[jt]sx$/u.test(filePath) &&
        (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
      )
        add("FRONTEND", "JSX UI syntax", node);
    }
    return { signals };
  } catch (error) {
    if (error instanceof RangeError) return { signals: [], limitation: "SYNTAX_LIMIT" };
    throw error;
  }
}
