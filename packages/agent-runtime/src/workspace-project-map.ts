import ts = require("typescript");
import { dirname, join } from "node:path";
import type { Node as SyntaxNode, Language as SyntaxLanguage } from "@vscode/tree-sitter-wasm";

export interface ProjectMapSymbol {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly signature: string;
}

/** Syntax-only map: compiler parser is reused; it does not load tsconfig/plugins or execute project code. */
export interface ProjectMapFile {
  readonly symbols: readonly ProjectMapSymbol[];
  readonly imports: readonly string[];
  readonly truncated: boolean;
  readonly language?: string;
  readonly parser?: string;
  readonly syntaxErrors?: boolean;
}

export function parseProjectMapFile(path: string, source: string, limit: number): ProjectMapFile {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false);
  const symbols: ProjectMapSymbol[] = [];
  const imports = new Set<string>();
  let truncated = false;
  const add = (node: ts.Node, name: string, kind: string): void => {
    if (symbols.length >= limit) { truncated = true; return; }
    const start = node.getStart(file);
    const text = node.getText(file);
    const body = (node as ts.FunctionLikeDeclarationBase).body
      ?? (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer.body
        : undefined);
    const signature = (body ? source.slice(start, body.getStart(file)) : text.split(/\r?\n/)[0]).trim().replace(/\s+/g, " ").slice(0, 220);
    symbols.push({ name, kind, line: file.getLineAndCharacterOfPosition(start).line + 1, signature });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      imports.add(node.arguments[0].text);
    }
    if (ts.isFunctionDeclaration(node) && node.name) add(node, node.name.text, "function");
    else if (ts.isClassDeclaration(node) && node.name) add(node, node.name.text, "class");
    else if (ts.isInterfaceDeclaration(node)) add(node, node.name.text, "interface");
    else if (ts.isTypeAliasDeclaration(node)) add(node, node.name.text, "type");
    else if (ts.isEnumDeclaration(node)) add(node, node.name.text, "enum");
    else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.name) add(node, node.name.getText(file), "method");
    else if (ts.isConstructorDeclaration(node)) add(node, "constructor", "method");
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) add(node, node.name.text, "function");
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { symbols, imports: [...imports].slice(0, 80), truncated: truncated || imports.size > 80,
    language: /\.[cm]?js$|\.jsx$/i.test(path) ? "JavaScript" : "TypeScript", parser: "typescript", syntaxErrors: ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0 };
}

export function projectMapSupported(path: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx|py|pyi|go|rs)$/i.test(path);
}

const syntaxLanguages = new Map<string, Promise<SyntaxLanguage>>();
let syntaxRuntime: Promise<typeof import("@vscode/tree-sitter-wasm")> | undefined;
async function syntaxParser() {
  return syntaxRuntime ??= Promise.resolve().then(async () => {
    const runtime = require("@vscode/tree-sitter-wasm") as typeof import("@vscode/tree-sitter-wasm");
    await runtime.Parser.init({ locateFile: (file: string) => join(dirname(require.resolve("@vscode/tree-sitter-wasm")), file) });
    return runtime;
  }).catch(error => {
    syntaxRuntime = undefined;
    throw error;
  });
}

/** The bundled WASM grammars parse real syntax trees, without executing project code or native addons. */
export async function parseProjectStructure(path: string, source: string, limit: number, signal?: AbortSignal): Promise<ProjectMapFile> {
  if (/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path)) return parseProjectMapFile(path, source, limit);
  const language = /\.pyi?$/i.test(path) ? "python" : /\.go$/i.test(path) ? "go" : /\.rs$/i.test(path) ? "rust" : undefined;
  if (!language) return { symbols: [], imports: [], truncated: false };
  if (signal?.aborted) throw new Error("Project map cancelled");
  const runtime = await syntaxParser();
  let loading = syntaxLanguages.get(language);
  if (!loading) {
    loading = runtime.Language.load(join(dirname(require.resolve("@vscode/tree-sitter-wasm")), `tree-sitter-${language}.wasm`)).catch(error => {
      syntaxLanguages.delete(language);
      throw error;
    });
    syntaxLanguages.set(language, loading);
  }
  const parser = new runtime.Parser();
  let tree: ReturnType<typeof parser.parse> = null;
  try {
    parser.setLanguage(await loading);
    parser.setTimeoutMicros(100_000);
    tree = parser.parse(source);
    if (!tree) return { symbols: [], imports: [], truncated: true, language, parser: "tree-sitter-wasm" };
    const symbols: ProjectMapSymbol[] = [];
    const imports = new Set<string>();
    const stack: SyntaxNode[] = [tree.rootNode];
    let visited = 0, truncated = false;
    const definitions: Readonly<Record<string, string>> = language === "python"
      ? { function_definition: "function", class_definition: "class" }
      : language === "go" ? { function_declaration: "function", method_declaration: "method", type_spec: "type" }
      : { function_item: "function", function_signature_item: "function", struct_item: "struct", enum_item: "enum", trait_item: "trait", type_item: "type", mod_item: "module", const_item: "constant", static_item: "static", macro_definition: "macro" };
    while (stack.length) {
      if (signal?.aborted) throw new Error("Project map cancelled");
      if (++visited > 50_000) { truncated = true; break; }
      const node = stack.pop()!;
      const kind = definitions[node.type];
      const name = kind && node.childForFieldName("name");
      if (kind && name) {
        if (symbols.length >= limit) truncated = true;
        else {
          const body = node.childForFieldName("body");
          const signature = source.slice(node.startIndex, body?.startIndex ?? node.endIndex).trim().replace(/\s+/g, " ").slice(0, 220);
          symbols.push({ name: name.text, kind, line: node.startPosition.row + 1, signature });
        }
      }
      if (language === "python" && (node.type === "import_statement" || node.type === "import_from_statement")
        || language === "go" && node.type === "import_spec" || language === "rust" && node.type === "use_declaration") {
        if (imports.size < 80) imports.add(node.text.replace(/\s+/g, " ").slice(0, 300));
        else truncated = true;
      }
      const children = node.namedChildren;
      for (let index = children.length - 1; index >= 0; index--) if (children[index]) stack.push(children[index]!);
    }
    return { symbols, imports: [...imports], truncated, language, parser: "tree-sitter-wasm", syntaxErrors: tree.rootNode.hasError };
  } finally {
    tree?.delete();
    parser.delete();
  }
}
