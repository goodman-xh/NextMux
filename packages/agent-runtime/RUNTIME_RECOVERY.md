# Runtime delegation, steering and recovery contract

## Council delegation

The lead remains responsible for decomposition, acceptance and final delivery.
It calls `agent.delegate` with a role, self-contained task and acceptance criteria.
Legacy roles normalize to `planning`, `frontend` and `backend`; missing roles use
the shared generalist (杂活/其他) pool, then a randomly selected non-lead-only slot
(the settings copy: 负责人随机分配). An unknown explicit slot ID is ignored and the
role routes as usual. No eligible route means the lead must do
the work itself and disclose that no specialist participated.

`AgentCouncilDispatcher.resolve(role, slotId, invocationKey)` synchronously
reserves a rotating assignment before asynchronous child setup. Reusing the
same key returns the same assignment. The host must persist the selected
slot/model binding with the durable operation; a new dispatcher after a crash
cannot reconstruct a random decision from task text alone. The runner executes
delegations serially within a batch to account for each child's token usage.

Each child owns an AbortController, follows its parent's signal, and closes its
own signal when finished. Grandchildren inherit that chain. A child never aborts
its parent's controller. Model waits, structured questions and built-in file
commits observe cancellation; managed processes receive process-tree shutdown.
Permission/question hosts must honor the supplied child signal.

The registry waits up to 750 ms for ordinary tool cancellation, or 30 seconds
for delegated cleanup and persistence. An uncooperative handler is reported as
`unsettled: true`, with unknown usage. A durable pending call remains `running`;
it is not recorded as successfully completed or automatically replayed. An
unknown side effect propagates through `tool_completed.unknownSideEffect` and
child receipts. Arbitrary in-process custom JavaScript cannot be forcibly
terminated by AbortSignal: tool authors must honor it or isolate execution in a
managed process. Process shutdown is bounded, not instantaneous.

Model failure returns a structured `error.childReceipt` to the lead. Workspace
review failure preserves the actual child result and usage, adds
`workspaceReviewError`, and disables automatic retry. Partial snapshots expose
coverage warnings and excluded paths; only captured changes can be merged.

## Durable execution

Hosts opt into v3 with `AgentRunnerOptions.onDurableCheckpoint`. Every pending
batch and each `running` transition are acknowledged before invocation. An ACK
must contain the original scope/admission, exact checkpoint hash, positive
revision and opaque `resume-<uuid>` handle. Hosts must return it only after
their durable store transaction commits. Legacy embedding callers without this
callback do not acquire a checkpoint-before-act guarantee.

Each result is checkpointed before pairing and usage accounting. Recovery first
hydrates the original admitted calls. If a tool execution ledger has already
committed a result, `recoverCommitted` restores its output, attachments and usage
using the exact admission identity. It never invokes the tool. A new v3 batch
does not use legacy semantic replay from an earlier batch.

A crash after an external effect but before *any* durable result record is an
unknown outcome. Exactly-once external effects cannot be inferred from a
missing record: recovery raises `DURABLE_TOOL_UNKNOWN` and requires verification.
It neither reruns the tool nor fabricates a lost result. Hosts should persist
the original pending checkpoint rather than converting it to a fresh prompt.

`AgentDurableDelegationClaim` also supports:

- `resumeCheckpoint`: host-verified original child checkpoint, with the same
  child run ID and `logicalParentOperationId`. Resolve the original model/slot.
  Write-capable continuations pass `resume: true` to `prepareWorkspace`.
- `abortBeforeStart(reason)`: optionally release/reset a running admission when
  model-client/workspace setup fails before any child model/tool starts. The
  host must perform an ownership/revision-checked transition with zero work;
  this hook must never reset an unknown executed effect.
- `cachedResult`: a durable authoritative terminal result. Non-durable caching
  continues to accept only completed children. Unknown effects cannot be
  converted into a cancelled-result cache hit.

`DelegatedWorkspaceManager.prepare({ ...originalOwner, resume: true })` reopens
the original stopped checkout, preserves its baseline/edits, checks ownership,
and rejects active, merged or merging workspaces. A dead owner's checkout is
made reviewable by the existing recovery check; live ownership is not stolen.

Original message `at`/`createdAt` values survive history validation, replay and
retention during compaction. Checkpoint rebase/retry preserves the source
checkpoint creation timestamp. Newly generated checkpoints and runtime events
still receive their own creation timestamps.

## Live goal updates: host integration

Persist the latest conversation goal at save time, then enqueue this message:

```ts
const update: AgentSteeringMessage = {
  id: 'goal-update-<stable-save-id>',
  kind: 'goal_update',
  content: 'The complete replacement goal',
  createdAt: '<original save timestamp>'
};
// Existing runner boundary callback:
new AgentRunner({ /* existing options */, takeSteeringMessages: () => drainQueue() });
```

Omitting `kind`, or using `direction`, keeps the existing additive steering
behavior. Content must contain 1–20,000 characters. The runtime accepts at most
16 queued messages/80,000 characters per drain; the host should replace older
queued goal updates before draining and keep additive directions separately.

At the next model boundary, including after a long tool batch, the newest goal
in the drained batch replaces the task anchor and task-context goal, clears the
old plan/question stop, and inserts a reminder explicitly superseding previous
scope. It does not interrupt an admitted tool halfway through execution. Goal
edits do not reset token/turn budgets. The checkpoint stores `activeGoal`, so
compaction and restart do not reassert the old scope or plan. Deliver updates
saved while paused before the first resumed model step. Re-delivery of the
currently active goal ID is idempotent; stable IDs must never name different text.

The host emits `steering_accepted` after persisting/queuing the save. The runtime
emits `steering_applied` with `{ message, turn, at }`. This event alone is not a
durable ACK: retain the saved update until a committed checkpoint contains its
`activeGoal.id`. A crash before that commit requires re-delivery from host state.

Required host changes (outside this package's ownership):

1. In `NextMuxPlatformServiceImpl.saveCodingGoalFile`, after `writeCodingGoalFile`
   succeeds, persist/enqueue the typed update for the owning active or paused
   conversation. Extend `sendAgentRunMessage` or add a typed goal method; its
   current string-only input loses replacement semantics and its follow-up
   disposition while a question is pending is unsuitable for goal replacement.
   `startAgentRunForProject`'s `takeSteeringMessages` closure already feeds the runner.
   A concrete internal signature is
   `queueAgentGoalUpdate(runId: string, update: AgentSteeringMessage): Promise<void>`;
   pass the parsed goal body from `request.content`, not the YAML ownership
   header. Persist updates while paused, coalesce queued updates, and inject
   them into the resumed job before its first drain.
2. In that same start path, change `requestUserInput` to
   `(question, signal) => userInput.request(question, signal ?? job.controller.signal)`.
3. In `executeAgentRun`'s durable delegation `admit` callback, reject an absent
   council decision with `COUNCIL_ROUTE_UNAVAILABLE` when Council is configured;
   do not substitute `durable-parent-route`. Persist/reuse the original decision.
   `normalizeCouncilRunRequest` currently throws before the runner on invalid
   Council configuration. When a valid parent route remains available, disable
   delegation for that run and append the explicit lead-does-the-work notice
   instead of rejecting the entire user task. Keep invalid parent routes rejected.
4. `AgentDurableOperationStore.complete/loadResult/admit/begin` and the host
   claim's `complete` callback must distinguish verified terminal cancelled,
   paused/limited/failed outcomes from `interrupted_unknown`. Keep unknown effects
   blocked. Add a revision-checked pre-start abort hook and host-authorized
   continuation supplying `resumeCheckpoint`, original child identity, original
   operation binding, workspace ownership and execution leases. Do not resume
   an unknown effect or reuse an unverified model result automatically.
5. In `nextmux-agent-task-queue.ts`, `agentManualResumeStrategy` currently
   refuses media-capacity pauses unconditionally. Allow explicit resume after
   switching to sufficient model capacity or replacing oversized input media.
   In `nextmux-agent-outcome-locale.ts`, update `mediaContextBody` translations
   to explain that the newest media alone is too large and give those remedies.
   Retain the existing prohibition on automatic redispatch.

## Media and partial snapshot limits

Compaction removes old image/audio payloads and records name, kind, MIME, byte
size and known dimensions/duration in textual continuity memory. The latest
user media is retained once; recent observation media is retained while it fits.
The provider-specific estimator determines admission, not base64 compression.
If the newest user media alone exceeds the input limit, the explicit
`media_context_compaction_required` response asks for smaller images, shorter
audio/split attachments or a larger context window. Other fixed-context
overflows remain `context_window_exceeded`.

ACP sends historical media identity as text and current attachments through its
capability-checked protocol. ACP's external agent owns its internal model loop;
this package cannot guarantee that arbitrary external agents compact internally.

Snapshot file/byte/entry limits are partial coverage, not failed commands.
Snapshots persist `complete: false`, warnings and excluded paths. Unenumerated
paths have no absence proof and cannot be interpreted as newly created/deleted.
Delegated partial snapshots use captured-only copies rather than substituting
stale Git HEAD bytes. Review/merge omits excluded paths. Individual file edits
still use their own backups; ordinary I/O corruption, permission errors and
merge conflicts remain errors independently of snapshot budgets.

## Design references and verification scope

The adopted pattern is a manager using bounded specialist tools, scoped child
context and explicit outcome records: [OpenAI agents as tools](https://openai.github.io/openai-agents-python/multi_agent/),
[LangGraph supervisor](https://github.com/langchain-ai/langgraph-supervisor-py),
[CrewAI hierarchical manager](https://docs.crewai.com/v1.15.28/en/learn/hierarchical-process),
and [Magentic-One orchestration](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html).
Durable boundaries follow the replay/side-effect separation described in
[LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence).
ACP transport behavior is bounded by the [prompt-turn protocol](https://agentclientprotocol.com/protocol/v1/prompt-turn).
These references inform the existing implementation; no orchestrator dependency
or claim of automatic external exactly-once execution is introduced.

Tests use synthetic model/provider responses, local fault injection, actual
filesystem snapshots and managed subprocesses. Live provider sessions, desktop
SQLite integration and Windows process-tree shutdown are not established by
these tests. The feature-atlas owner should update stable IDs
`programming.agent.delegation`, `programming.runtime.context`,
`programming.runtime.recovery`, and `programming.runtime.command_checkpoint` in
`../项目画图/parts/programming/features.json` and regenerate the official artifacts.
