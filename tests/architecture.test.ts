import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Static checks only: importing production services would warm the native helper
// and could query Accessibility or close the Raycast panel.
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  commands: Array<{ name: string; mode: string }>;
};
const options: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Node10,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
  });
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function moduleReferences(file: ts.SourceFile): string[] {
  const refs: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      refs.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      refs.push(node.argument.literal.text);
    }
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require") ||
          (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
            ["vi", "vitest", "jest"].includes(callee.expression.text) &&
            ["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"].includes(callee.name.text))) {
        refs.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(refs)];
}

function hasDefaultExport(file: ts.SourceFile): boolean {
  return file.statements.some((statement) =>
    (ts.isExportAssignment(statement) && !statement.isExportEquals) ||
    (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) ||
    (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((element) => element.name.text === "default")),
  );
}

const files = [...sourceFiles(src), ...sourceFiles(path.join(root, "tests"))];
const references = files.flatMap((file) => moduleReferences(parse(file)).map((specifier) => ({ file, specifier })));
const relativeReferences = references.filter(({ specifier }) => specifier.startsWith("."));
const resolvedReferences = relativeReferences.map((reference) => ({
  ...reference,
  target: ts.resolveModuleName(reference.specifier, reference.file, options, ts.sys).resolvedModule?.resolvedFileName,
}));
const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");

describe("refactor architecture", () => {
  it("keeps a default-exporting root entry for every manifest command", () => {
    expect(manifest.commands.length).toBeGreaterThan(0);
    for (const command of manifest.commands) {
      const entry = ["ts", "tsx", "js", "jsx"].map((extension) => path.join(src, `${command.name}.${extension}`)).find(fs.existsSync);
      expect(entry, `missing root entry for ${command.name} (${command.mode})`).toBeDefined();
      expect(hasDefaultExport(parse(entry!)), `${command.name} must have a default export`).toBe(true);
    }
  });

  it("resolves relative source/test imports, re-exports, import types, and mocks", () => {
    expect(resolvedReferences.filter(({ target }) => !target).map(({ file, specifier }) => `${relative(file)} -> ${specifier}`)).toEqual([]);
  });

  it("keeps domain and utilities independent of services, views, and Raycast", () => {
    const violations = references.filter(({ file, specifier }) => {
      if (!/^src\/(domain|utils)\//.test(relative(file))) return false;
      if (specifier === "@raycast/api" || specifier.startsWith("@raycast/api/")) return true;
      const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      return !!target && /^src\/(services|views)\//.test(relative(target));
    });
    expect(violations.map(({ file, specifier }) => `${relative(file)} -> ${specifier}`)).toEqual([]);
  });

  it("keeps services below views and prevents imports through root commands or obsolete flat modules", () => {
    const violations = resolvedReferences.filter(({ file, target }) => {
      if (!target || !relative(file).startsWith("src/")) return false;
      const from = relative(file);
      const to = relative(target);
      // Root files are entry points only, not a shared-module compatibility layer.
      if (/^src\/[^/]+\.[jt]sx?$/.test(to)) return true;
      return from.startsWith("src/services/") && to.startsWith("src/views/");
    });
    expect(violations.map(({ file, specifier }) => `${relative(file)} -> ${specifier}`)).toEqual([]);
  });

  it("resolves Swift assets from the flat Raycast bundle, not the provider source directory", () => {
    expect(fs.existsSync(path.join(root, "assets", "windowkit.swift"))).toBe(true);
    const provider = parse(path.join(src, "services", "windows", "provider-windowkit.ts"));
    const swiftAssetCalls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && arg.text === "windowkit.swift")) {
        swiftAssetCalls.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(provider);
    expect(swiftAssetCalls).toHaveLength(1);
    const call = swiftAssetCalls[0];
    expect(call.expression.getText(provider)).toBe("path.join");
    expect(call.arguments.map((arg) => ts.isStringLiteralLike(arg) ? arg.text : arg.getText(provider)))
      .toEqual(["__dirname", "assets", "windowkit.swift"]);
    // Raycast emits <command>.js beside assets/, regardless of TS module depth.
    // A source-relative ../../assets fix would silently force AppleScript fallback.
  });
});
