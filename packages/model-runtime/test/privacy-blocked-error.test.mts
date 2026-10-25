import assert from "node:assert/strict";
import test from "node:test";
import { formatModelError } from "../lib/index.js";

test("legacy route_privacy_unavailable never blames privacy settings and stays a retryable route error", () => {
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "fr", "de", "pt-BR", "ru", "ar", "hi"]) {
    const readable = formatModelError({ code: "route_privacy_unavailable", httpStatus: 400, message: "No available route meets your privacy settings", source: "relay" }, locale);
    assert.equal(readable.action, "retry", locale);
    assert.equal(readable.retryable, true, locale);
    assert.doesNotMatch(readable.text, /隐私设置|privacy settings/i, locale);
  }
});
