/** Self-contained worker entry: stringify after compilation so bundled desktops need no worker asset. */
export function runTypeScriptDiagnosticWorker(): void {
  const { parentPort, workerData } = require("node:worker_threads") as typeof import("node:worker_threads");
  const ts = require(workerData.typescriptPath) as typeof import("typescript");
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const root = fs.realpathSync(workerData.workspaceRoot as string);
  const rootNodeModules = path.join(root, "node_modules");
  const libraryRoot = path.dirname(fs.realpathSync(path.dirname(workerData.typescriptPath as string)));
  const standardLibraryRoot = workerData.libraryPath ? fs.realpathSync(workerData.libraryPath as string) : path.join(libraryRoot, "lib");
  const inside = (base: string, file: string): boolean => {
    const relative = path.relative(base, file);
    return !relative || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  parentPort!.on("message", (request: { id: number; path: string; content: string; sha256: string }) => {
    let bytes = 0, files = 0, directories = 0;
    const reads = new Map<string, string | undefined>();
    const allowedNodeModuleTargets = new Set<string>();
    const unavailable = (reason: string): never => { throw new Error(reason); };
    try {
      const absolute = path.resolve(root, request.path);
      if (!inside(root, absolute)) unavailable("outside_workspace");
      if (crypto.createHash("sha256").update(request.content).digest("hex") !== request.sha256) unavailable("version_mismatch");
      const read = (file: string): string | undefined => {
        const resolved = path.resolve(file);
        if (resolved === absolute) return request.content;
        if (reads.has(resolved)) return reads.get(resolved);
        if (++files > 500) unavailable("project_file_budget_exceeded");
        let text: string | undefined;
        try {
          const actual = fs.realpathSync(resolved);
          const lexicallyInNodeModules = inside(rootNodeModules, resolved);
          if (lexicallyInNodeModules) {
            allowedNodeModuleTargets.add(path.dirname(actual));
          }
          const inAllowedNodeModules = lexicallyInNodeModules
            || [...allowedNodeModuleTargets].some(base => inside(base, actual));
          if (!inside(root, actual) && !inside(libraryRoot, actual) && !inside(standardLibraryRoot, actual) && !inAllowedNodeModules) unavailable("dependency_outside_workspace");
          const size = fs.statSync(actual).size;
          if (size > 4 * 1024 * 1024 || (bytes += size) > 24 * 1024 * 1024) unavailable("project_byte_budget_exceeded");
          text = fs.readFileSync(actual, "utf8");
        } catch (error) {
          if (!(error as NodeJS.ErrnoException).code || !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code!)) throw error;
        }
        reads.set(resolved, text);
        return text;
      };
      let options: import("typescript").CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, types: [] };
      let rootNames = [absolute];
      let directory = path.dirname(absolute), configPath: string | undefined;
      while (inside(root, directory)) {
        configPath = ["tsconfig.json", "jsconfig.json"].map(name => path.join(directory, name)).find(file => fs.existsSync(file));
        if (configPath || directory === root) break;
        directory = path.dirname(directory);
      }
      if (configPath) {
        const config = ts.readConfigFile(configPath, read);
        if (config.error) unavailable("invalid_project_configuration");
        const parsed = ts.parseJsonConfigFileContent(config.config, {
          useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
          fileExists: ts.sys.fileExists,
          readFile: read,
          readDirectory: (directory, extensions, excludes, includes, depth) => {
            if (++directories > 50) unavailable("project_directory_budget_exceeded");
            const entries = ts.sys.readDirectory(directory, extensions, excludes, includes, depth);
            if (entries.length > 500) unavailable("project_file_budget_exceeded");
            return entries;
          },
        }, path.dirname(configPath), undefined, configPath);
        // A newly-created first source file may leave the pre-write include empty (18003).
        if (parsed.errors.some(error => error.code !== 18003)) unavailable("invalid_project_configuration");
        if (parsed.projectReferences?.length) unavailable("project_references_require_language_server");
        options = { ...parsed.options, allowJs: true, noEmit: true, skipLibCheck: true };
        rootNames = [...new Set([...parsed.fileNames, absolute])];
        if (rootNames.length > 500) unavailable("project_file_budget_exceeded");
      }
      if (options.noCheck || /\.[cm]?jsx?$/i.test(absolute) && configPath && options.checkJs !== true) unavailable("project_semantic_checking_disabled");
      const host = ts.createCompilerHost(options, true);
      host.getCurrentDirectory = () => root;
      host.getDefaultLibFileName = options => path.join(standardLibraryRoot, ts.getDefaultLibFileName(options));
      host.getDefaultLibLocation = () => standardLibraryRoot;
      host.readFile = read;
      const originalExists = host.fileExists;
      host.fileExists = file => path.resolve(file) === absolute || originalExists(file);
      host.getSourceFile = (file, languageVersion) => {
        const content = read(file);
        return content === undefined ? undefined : ts.createSourceFile(file, content, languageVersion, true);
      };
      const program = ts.createProgram(rootNames, options, host);
      if (program.getOptionsDiagnostics().length || program.getGlobalDiagnostics().length) unavailable("invalid_project_configuration");
      const source = program.getSourceFile(absolute);
      if (!source) unavailable("document_not_in_project");
      const all = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
        .filter(item => item.category === ts.DiagnosticCategory.Error);
      const errors = all.slice(0, 100).map(item => {
        const start = item.start ?? 0, at = source!.getLineAndCharacterOfPosition(start);
        return { source: "typescript", code: String(item.code), message: ts.flattenDiagnosticMessageText(item.messageText, "\n").slice(0, 2000),
          line: at.line + 1, column: at.character + 1,
          anchor: source!.text.slice(start, start + Math.max(1, Math.min(item.length ?? 1, 160))) };
      });
      parentPort!.postMessage({ id: request.id, result: { status: all.length > 100 ? "unavailable" : "ready", sha256: request.sha256,
        source: "typescript", ...(all.length > 100 ? { reason: "diagnostic_limit_exceeded" } : { errors }) } });
    } catch (error) {
      const known = /^(outside_workspace|version_mismatch|project_.*|dependency_outside_workspace|invalid_project_configuration|document_not_in_project)$/;
      const message = error instanceof Error ? error.message : "";
      parentPort!.postMessage({ id: request.id, result: { status: "unavailable", sha256: request.sha256, source: "typescript",
        reason: known.test(message) ? message : "diagnostic_failed" } });
    }
  });
}
