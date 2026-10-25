import assert from "node:assert/strict";
import test from "node:test";
import { OfficialModelError, OrderedModelOutput } from "../lib/index.js";

// Admission-header fixtures, not a claim that these bytes are decodable audio.
const fixtures = [
  { mime: "audio/wav", length: 44, signatures: [[0, "RIFF"], [8, "WAVE"]] },
  { mime: "audio/mpeg", length: 10, signatures: [[0, "ID3"]] },
  { mime: "audio/ogg", length: 27, signatures: [[0, "OggS"]] },
  { mime: "audio/flac", length: 8, signatures: [[0, "fLaC"]] },
] as const;

for (const fixture of fixtures) {
  test(`${fixture.mime} header matching does not erase the high bit of untrusted bytes`, () => {
    const bytes = Buffer.alloc(fixture.length);
    for (const [offset, signature] of fixture.signatures) bytes.write(signature, offset);
    const accepted = new OrderedModelOutput(true);
    accepted.media(fixture.mime, () => bytes.toString("base64"));
    assert.equal(accepted.finish({ inputTokens: 1, outputTokens: 2 }, true)?.[0]?.type, "audio");
    for (const [offset, signature] of fixture.signatures) {
      for (let index = 0; index < signature.length; index++) {
        const polluted = Buffer.from(bytes); polluted[offset + index]! |= 0x80;
        const output = new OrderedModelOutput(true);
        output.media(fixture.mime, () => polluted.toString("base64"));
        assert.throws(() => output.finish({ inputTokens: 1, outputTokens: 2 }, true), (error: unknown) => {
          assert.ok(error instanceof OfficialModelError);
          assert.equal(error.code, "INVALID_OUTPUT"); assert.equal(error.retrySafe, false);
          assert.equal(error.usageKnown, true); assert.deepEqual(error.usage, { inputTokens: 1, outputTokens: 2 });
          return true;
        });
      }
    }
  });
}
