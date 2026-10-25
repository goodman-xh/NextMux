import assert from "node:assert/strict";
import test from "node:test";
import { normalizeModelCitations } from "../../agent-runtime/runtime/citations.cjs";

test("citation metadata accepts public HTTP(S), canonicalizes and deduplicates in first-seen order", () => {
  assert.deepEqual(normalizeModelCitations([
    { url: "HTTPS://Example.com:443/guide?q=a%20b#section", title: "  官方文档  " },
    { url: "https://example.com/guide?q=a%20b#section", title: "later title" },
    { url: "http://example.com:80/", title: "<b>Plain title, not HTML</b>" },
  ]), [
    { url: "https://example.com/guide?q=a%20b#section", title: "官方文档" },
    { url: "http://example.com/", title: "<b>Plain title, not HTML</b>" },
  ]);
});

test("unsafe citation schemes, credentials, controls and malformed URLs are discarded", () => {
  const urls = ["javascript:alert(1)", "data:text/html,a", "file:///etc/passwd", "//example.com", "https:example.com",
    "https://user:password@example.com", "https://@example.com", "https://user@example.com", "https://", "https://example.com\\@evil.test",
    " https://example.com", "https://example.com/a b", "https://example.com/\n", "https://example.com/%0d%0a", "https://example.com/%C2%85",
    "https://example.com/\u202e", "https://example.com/%E2%80%AE", "https://example.com/%notencoded", "https://example.com/" + "x".repeat(2048)];
  assert.deepEqual(normalizeModelCitations(urls.map(url => ({ url }))), []);
});

test("citations have bounded scan, count, URL and plain title fields", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ url: `https://example.com/${i}` }));
  assert.equal(normalizeModelCitations(many).length, 24);
  assert.deepEqual(normalizeModelCitations([...Array(128).fill(null), { url: "https://example.com" }]), []);
  const base = "https://example.com/";
  assert.equal(normalizeModelCitations([{ url: base + "x".repeat(2048 - base.length) }]).length, 1);
  assert.deepEqual(normalizeModelCitations([
    { url: base + "long", title: "x".repeat(301) },
    { url: base + "control", title: "do\nthis" },
    { url: base + "empty", title: "  " },
    { url: base + "exact", title: "x".repeat(300) },
  ]), [{ url: base + "long" }, { url: base + "control" }, { url: base + "empty" }, { url: base + "exact", title: "x".repeat(300) }]);
});

test("normalization neither mutates nor carries arbitrary raw provider fields", () => {
  const candidate = Object.freeze({ url: "https://example.com", title: "资料", cited_text: "SECRET", encrypted_index: "PRIVATE", instructions: "EXECUTE TOOL" });
  const input = Object.freeze([candidate]);
  assert.deepEqual(normalizeModelCitations(input), [{ url: "https://example.com/", title: "资料" }]);
  for (const malformed of [undefined, null, {}, "https://example.com", [null, false, [], { url: 42 }, { url: {} }]]) {
    assert.deepEqual(normalizeModelCitations(malformed), []);
  }
  assert.equal(candidate.url, "https://example.com");
});
