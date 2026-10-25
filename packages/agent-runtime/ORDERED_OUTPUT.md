# Ordered output reference preservation

This runtime layer preserves references; it does not publish, read, authorize,
decode or render image/audio assets. No desktop or model provider is enabled by
this change. A host must explicitly pass `acceptOrderedOutput: true` after its
publisher, owner-bound resolver, persistence and UI are ready.

## Contract

`AgentOutputPart` is either `{ type: 'text', text }` or
`{ type: 'image' | 'audio', asset: { sha256, mimeType, sizeBytes } }`.
The digest is an identity, **not** a read capability. There are no paths, URLs,
base64 bytes or self-asserted owners. The trusted host must authorize every
position using its current run/conversation and already stored turn membership.
Repeated assets at separate positions remain separate parts.

The dependency-free `@nextmux/agent-runtime/output-parts` subpath exports
`normalizeAgentOutputParts` and `AgentOutputPartsError`. Validation is strict,
all-or-nothing and returns a frozen whitelist copy. Invalid input, sparse arrays,
accessors and exceptional proxy operations receive a fixed
`INVALID_OUTPUT_PARTS` error. Unopted consumers receive
`OUTPUT_PARTS_UNSUPPORTED`. Neither error is safe to retry automatically.

Limits per message: 64 parts, 16 media positions, 2 MiB UTF-8 text, 10 MiB per
image, 24 MiB per audio and 32 MiB cumulative media including repeated positions.
Allowed MIME types: PNG/JPEG/WebP/GIF and WAV/MPEG/OGG/FLAC. These are metadata
limits only; the model/host layer must verify exact bytes/hash, MIME and dimensions.

When parts are present, their text parts concatenated exactly (including
whitespace) are the sole `content`/`finalText` projection. Pure media has empty
text. Runtime status explanations are not fabricated model content.
An empty ordered array with no planned tools is a fixed invalid-response error,
not a successful pure-media answer; with planned tools it still gets paired
not-executed results when a budget or cancellation blocks them.

## Runtime safety

- `model_completed`, the current result and the assistant message preserve the
  same ordered parts. A later model turn or parent answer does not inherit an
  earlier tool turn's or child's result parts.
- Checkpoint v1 remains the legacy text-only contract, including its narrow
  old missing-tool-tail repair. A checkpoint containing an `outputParts` field
  requires v2 (even an empty array); v2 requires complete tool/result pairing
  and cannot invoke that legacy repair. Child checkpoints remain child-owned.
- A budget stop after accepted output preserves its assistant message and
  explicit not-executed results for every planned tool. Usage is recorded once;
  neither tools nor a second model request run at that boundary.
- Output/attempt/progress observer failure before tools yields fixed
  `OUTPUT_EVENT_DELIVERY_FAILED`, preserving accepted references and blocked
  tool pairs. Paid adapter rejection preserves its provided usage before an
  observer can cancel. Unknown usage remains unknown, never free.
- Automatic backend fallback cannot override accepted output, explicit unsafe
  errors or paid evidence. ACP rejects ordered requests before starting a
  process. The builtin capability flag means preservation only.
- If compaction removes an older media-bearing group, its attachments and
  ordered output parts are summarized as structured descriptors in the
  continuity memory message while preserving the latest user attachments and recent
  turns, and retained binary attachments are sliding-window pruned when needed
  to fit context or transport limits.

## Verification and remaining integration

Offline `output-parts.test.mts` and `ordered-output.test.mts` exercise real
normalizers, runner, router, builtin/ACP preflight and delegated child paths.
They use inert hashes and synthetic model/tool counters, not real media/API
calls. The original regressions were run red before the corresponding fixes.

The input budget continues to use the existing provider-neutral JSON admission
estimate; it is not an exact image/audio token meter. Actual validated provider
usage remains necessary. Durable asset publication, per-owner reads, byte replay,
RPC, widget/history/archive handling and provider/media compatibility require
their separate host/model-layer integration before opting in.
