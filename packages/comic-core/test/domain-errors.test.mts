import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import ts from "typescript";
import { ComicCoreError, ComicProductionStore, ComicProductionRunStore, COMIC_PRODUCTION_FILE, COMIC_PRODUCTION_RUN_FILE,
  boundedText, integer, estimateMusicLyrics, splitMusicMvSegments } from "../lib/index.js";
// Test the browser-safe catalog without requiring a model-runtime build or importing Node-only adapters.
const localeSource = await readFile(new URL("../../model-runtime/src/comic-error-locales.ts", import.meta.url), "utf8");
const localeModule = ts.transpileModule(localeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { COMIC_ERROR_LOCALES, COMIC_ERROR_MESSAGE_KEYS, formatComicDomainError } = await import(`data:text/javascript;base64,${Buffer.from(localeModule).toString("base64")}`) as typeof import("../../model-runtime/src/comic-error-locales.js");

function caught(work: () => unknown): ComicCoreError {
  try { work(); } catch (error) { assert.ok(error instanceof ComicCoreError); return error; }
  throw new Error("Expected a comic domain error");
}

test("MV failures carry stable reasons and numeric params while keeping authored lyrics unchanged", () => {
  const duration = caught(() => estimateMusicLyrics("保持歌词原文", 0));
  const density = caught(() => estimateMusicLyrics("甲\n乙", 1));
  const segment = caught(() => splitMusicMvSegments([], 1_000, "", 25_001));
  assert.equal(duration.code, "INVALID_MUSIC_DURATION");
  assert.deepEqual(duration.params, { minimum: 1, maximum: 3_600_000 });
  assert.equal(density.code, "MUSIC_LYRICS_TOO_DENSE");
  assert.deepEqual(density.params, { durationMs: 1, lineCount: 2 });
  assert.equal(segment.code, "INVALID_MV_SEGMENT_DURATION");
  assert.deepEqual(segment.params, { minimum: 1, maximum: 25_000 });
  for (const error of [duration, density, segment]) {
    assert.equal(error.domain, "comic");
    assert.equal(error.readableError.detail, error.message);
    assert.equal(error.readableError.messageKey, error.messageKey);
    assert.deepEqual(JSON.parse(JSON.stringify(error)).readableError.params, error.params);
    const en = formatComicDomainError(error.messageKey, error.params, "en");
    for (const locale of COMIC_ERROR_LOCALES) {
      const text = formatComicDomainError(error.messageKey, error.params, locale);
      assert.ok(text && !/[{}]/.test(text));
      if (locale !== "en") assert.notEqual(text, en, `${locale} must have its own translation`);
      assert.doesNotMatch(text, /model request failed/i);
    }
  }
  assert.equal(estimateMusicLyrics("保持歌词原文", 1_000)[0].text, "保持歌词原文");
});

test("same-code validation failures preserve separate reasons and field/range params", () => {
  const text = caught(() => boundedText(4, "shot.title", 120));
  const range = caught(() => integer(500, "shot.duration", 1, 100));
  assert.equal(text.code, range.code);
  assert.notEqual(text.messageKey, range.messageKey);
  assert.deepEqual(range.params, { field: "shot.duration", minimum: 1, maximum: 100 });
  for (const locale of COMIC_ERROR_LOCALES) {
    const value = formatComicDomainError(range.messageKey, range.params, locale)!;
    assert.match(value, /1/);
    assert.match(value, /100/);
    assert.match(value, /shot\.duration/);
    assert.notEqual(value, formatComicDomainError(text.messageKey, text.params, locale));
  }
});

test("production document errors distinguish malformed JSON from invalid schema in all locales", async t => {
  const root = await mkdtemp(join(tmpdir(), "comic-error-language-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionStore.create({ workspaceRoot: root });
  const errors: Array<{ code: string; messageKey: string; params: Record<string, string | number | boolean>; message: string }> = [];
  for (const content of ["{broken", "{}"] ) {
    await writeFile(join(root, COMIC_PRODUCTION_FILE), content);
    await assert.rejects(store.read(), (error: unknown) => {
      assert.ok(error instanceof Error && "code" in error && "messageKey" in error && "params" in error);
      errors.push(error as typeof errors[number]);
      return true;
    });
  }
  assert.equal(errors[0].code, errors[1].code);
  assert.notEqual(errors[0].messageKey, errors[1].messageKey);
  assert.match(errors[0].message, /JSON/);
  assert.doesNotMatch(errors[1].message, /[\p{Script=Han}]/u);
  for (const locale of COMIC_ERROR_LOCALES) {
    assert.notEqual(formatComicDomainError(errors[0].messageKey, errors[0].params, locale),
      formatComicDomainError(errors[1].messageKey, errors[1].params, locale));
  }
});

test("old production recovery records receive localized metadata and retain raw details", async t => {
  const root = await mkdtemp(join(tmpdir(), "comic-recovery-language-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await ComicProductionRunStore.create(root);
  const run = await store.start({ requestKey: "legacy-language", workspaceId: "workspace", projectId: "project", scriptVersion: 1,
    authorization: { approvalId: "approved", approvedAt: "2026-09-28T00:00:00.000Z", maxEstimatedCostMicros: 0, routes: [] } });
  const path = join(root, COMIC_PRODUCTION_RUN_FILE);
  const legacy = JSON.parse(await readFile(path, "utf8"));
  legacy.runs[0].lastError = "旧版制作异常，用户内容不能误译";
  await writeFile(path, JSON.stringify(legacy));
  const loaded = await store.get(run.id);
  assert.equal(loaded.lastErrorInfo?.messageKey, "comic.production_waiting");
  assert.equal(loaded.lastErrorInfo?.detail, legacy.runs[0].lastError);
  assert.equal(loaded.lastError, legacy.runs[0].lastError);
  legacy.runs[0].lastErrorInfo = { domain: "comic", kind: "unknown", code: "BAD", messageKey: "comic.production_waiting", params: { nested: {} }, detail: "x" };
  await writeFile(path, JSON.stringify(legacy));
  await assert.rejects(store.read(), error => error instanceof Error && "code" in error && error.code === "PRODUCTION_RUN_CORRUPT");
});

test("every comic error source has an explicit reason catalogued in every locale", async () => {
  const sourceRoot = new URL("../src/", import.meta.url);
  let constructors = 0;
  const keys = new Set<string>();
  for (const filename of await readdir(sourceRoot)) {
    if (!filename.endsWith(".ts")) continue;
    const source = await readFile(new URL(filename, sourceRoot), "utf8");
    const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && /^(?:ComicCoreError|ComicProductionStoreError|ComicProductionRunError|ComicHierarchyError)$/.test(node.expression.getText(file))) {
        constructors++;
        const hierarchy = node.expression.getText(file) === "ComicHierarchyError";
        assert.ok(hierarchy ? node.arguments!.length >= 5 : node.arguments!.length === 4, `${filename}: explicit code, English diagnostic, key and params`);
        const key = node.arguments![hierarchy ? 3 : 2];
        assert.ok(ts.isStringLiteral(key), `${filename}: reason is a stable literal`);
        keys.add(key.text);
        assert.ok(COMIC_ERROR_MESSAGE_KEYS.includes(key.text as typeof COMIC_ERROR_MESSAGE_KEYS[number]), key.text);
        assert.doesNotMatch(node.arguments![hierarchy ? 0 : 1].getText(file), /[\p{Script=Han}]/u, `${filename}: model diagnostic is English`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.ok(constructors >= 240, `Audited ${constructors} current source occurrences`);
  const params = { minimum: 1, maximum: 100, durationMs: 1, lineCount: 2, count: 3, field: "shot.title" };
  for (const key of COMIC_ERROR_MESSAGE_KEYS) {
    const english = formatComicDomainError(key, params, "en");
    assert.ok(english, key);
    for (const locale of COMIC_ERROR_LOCALES) {
      const localized = formatComicDomainError(key, params, locale);
      assert.ok(localized && !/[{}]/.test(localized), `${key} / ${locale}`);
      if (locale !== "en") assert.notEqual(localized, english, `${key} / ${locale} must not fall back to English`);
    }
  }
  assert.equal(formatComicDomainError("comic.unknown_future_reason", {}, "ja"), undefined);
  assert.equal(formatComicDomainError("toString", {}, "fr"), undefined);
  assert.equal(formatComicDomainError("comic.music_duration", params, "zh-Hant-TW"), formatComicDomainError("comic.music_duration", params, "zh-TW"));
});
