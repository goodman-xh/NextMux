import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner, AgentToolRegistry, AgentUserInputBroker, AGENT_USER_INPUT_TOOL_NAME, validateUserQuestion, type AgentRunEvent, type AgentModelRequest } from "../lib/index.js";

const question = { prompt: "选择输出格式", options: [{ id: "csv", label: "CSV" }, { id: "json", label: "JSON" }] };
const owner = { runId: "run-question-one", taskId: "conversation-one" };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("questions have bounded stable options and cannot disable free text", async () => {
  for (const value of [{ prompt: "" }, { prompt: "a".repeat(2001) }, { prompt: "x", options: [question.options[0], question.options[0]] }, { prompt: "x", options: [{ id: "space id", label: "x" }] }]) {
    assert.throws(() => validateUserQuestion(value), { code: "INVALID_USER_QUESTION" });
  }
  const broker = new AgentUserInputBroker(owner);
  const waiting = broker.request({ ...question, allowFreeText: false });
  const pending = broker.pendingQuestion!;
  assert.equal(pending.allowFreeText, true);
  assert.throws(() => broker.request(question), { code: "USER_QUESTION_PENDING" });
  assert.throws(() => broker.answer({ ...pending, text: "x".repeat(10_001) }), { code: "INVALID_USER_ANSWER" });
  assert.throws(() => broker.answer({ ...pending, optionId: "x".repeat(81) }), { code: "INVALID_USER_ANSWER" });
  broker.answer({ ...pending, text: "自定义格式" });
  assert.deepEqual(await waiting, { status: "answered", answer: { text: "自定义格式" } });
});

test("answers bind question, run and task; duplicates are exactly once and conflicts fail", async () => {
  const events: AgentRunEvent[] = [];
  const broker = new AgentUserInputBroker({ ...owner, onEvent: event => { events.push(event); } });
  const waiting = broker.request(question);
  const pending = broker.pendingQuestion!;
  for (const changed of [{ runId: "run-question-two" }, { taskId: "conversation-two" }]) {
    assert.throws(() => broker.answer({ ...pending, ...changed, optionId: "csv" }), { code: "USER_QUESTION_OWNER_MISMATCH" });
  }
  assert.throws(() => broker.answer({ ...pending, optionId: "wrong" }), { code: "INVALID_USER_ANSWER" });
  assert.deepEqual(broker.answer({ ...pending, optionId: "csv", text: "UTF-8" }), { accepted: true });
  assert.deepEqual(broker.answer({ ...pending, optionId: "csv", text: "UTF-8" }), { accepted: true, replayed: true });
  assert.throws(() => broker.answer({ ...pending, optionId: "json" }), { code: "USER_ANSWER_CONFLICT" });
  assert.deepEqual(await waiting, { status: "answered", answer: { optionId: "csv", optionLabel: "CSV", text: "UTF-8" } });
  assert.equal(events.filter(event => event.type === "user_input_resolved").length, 1);
  assert.equal(broker.pendingQuestion, undefined);
});

test("cancel, abort, expiry and restarted brokers cannot accept stale answers", async () => {
  const broker = new AgentUserInputBroker({ ...owner, timeoutMs: 10 });
  let waiting = broker.request(question);
  const cancelled = broker.pendingQuestion!;
  broker.answer({ ...cancelled, cancelled: true });
  assert.deepEqual(await waiting, { status: "cancelled" });
  assert.throws(() => broker.answer({ ...cancelled, text: "late" }), { code: "USER_ANSWER_CONFLICT" });
  const controller = new AbortController();
  waiting = broker.request(question, controller.signal);
  const aborted = broker.pendingQuestion!;
  controller.abort();
  assert.deepEqual(await waiting, { status: "cancelled" });
  assert.throws(() => broker.answer({ ...aborted, text: "late" }), { code: "USER_QUESTION_STALE" });
  waiting = broker.request(question);
  const expired = broker.pendingQuestion!;
  assert.deepEqual(await waiting, { status: "expired" });
  assert.throws(() => broker.answer({ ...expired, text: "late" }), { code: "USER_QUESTION_STALE" });
  const restarted = new AgentUserInputBroker(owner);
  assert.throws(() => restarted.answer({ ...expired, text: "old run" }), { code: "USER_QUESTION_STALE" });
});

for (const failingEvent of ["user_input_requested", "user_input_resolved"] as const) {
  test(`a failed ${failingEvent} observer cannot strand the authoritative question waiter`, async () => {
    const broker = new AgentUserInputBroker({ ...owner, onEvent: event => {
      if (event.type === failingEvent) throw new Error("observer failure must not escape");
    } });
    const waiting = broker.request(question);
    const pending = broker.pendingQuestion!;
    assert.ok(pending);
    assert.deepEqual(broker.answer({ ...pending, text: "Explicit reply" }), { accepted: true });
    assert.deepEqual(await waiting, { status: "answered", answer: { text: "Explicit reply" } });
    assert.deepEqual(broker.answer({ ...pending, text: "Explicit reply" }), { accepted: true, replayed: true });
    assert.equal(broker.pendingQuestion, undefined);
  });
}

test("asynchronously rejected event observers are isolated from answer delivery", async () => {
  const broker = new AgentUserInputBroker({ ...owner, onEvent: async () => { throw new Error("async observer failure"); } });
  const waiting = broker.request(question);
  broker.answer({ ...broker.pendingQuestion!, text: "Reply" });
  assert.equal((await waiting).status, "answered");
  await tick();
});

test("replaying an older answer cannot settle a newer pending question", async () => {
  const broker = new AgentUserInputBroker(owner);
  const first = broker.request(question);
  const previous = broker.pendingQuestion!;
  broker.answer({ ...previous, text: "first" });
  await first;
  const second = broker.request(question);
  const current = broker.pendingQuestion!;
  assert.notEqual(current.questionId, previous.questionId);
  assert.deepEqual(broker.answer({ ...previous, text: "first" }), { accepted: true, replayed: true });
  assert.equal(broker.pendingQuestion!.questionId, current.questionId);
  broker.answer({ ...current, cancelled: true });
  assert.deepEqual(await second, { status: "cancelled" });
});

test("runner exposes a real question tool and waits independently from direction messages", async () => {
  const broker = new AgentUserInputBroker(owner);
  let calls = 0;
  let drains = 0;
  let resumed: AgentModelRequest | undefined;
  const running = new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only",
    requestUserInput: input => broker.request(input),
    takeSteeringMessages: () => { drains += 1; return []; },
    model: { async complete(request) {
      calls += 1;
      assert.ok(request.tools.some(tool => tool.name === AGENT_USER_INPUT_TOOL_NAME));
      if (calls === 1) return { toolCalls: [{ id: "question-tool-call", name: AGENT_USER_INPUT_TOOL_NAME, arguments: question }] };
      resumed = request;
      return { content: "按你的回答继续" };
    } },
  }).run({ prompt: "先询问格式再继续", runId: owner.runId });
  await tick();
  assert.equal(calls, 1);
  assert.equal(drains, 0, "a pending question must not consume direction messages");
  const pending = broker.pendingQuestion!;
  assert.ok(pending);
  broker.answer({ ...pending, text: "Markdown" });
  const result = await running;
  assert.equal(result.status, "completed");
  assert.equal(calls, 2);
  const reply = resumed!.messages.find(message => message.toolCallId === "question-tool-call");
  assert.equal(JSON.parse(reply!.content).output.answer.text, "Markdown");
});

test("human waiting is outside the model deadline but remains promptly cancellable", async () => {
  const controller = new AbortController();
  const broker = new AgentUserInputBroker(owner);
  let calls = 0;
  const running = new AgentRunner({
    tools: new AgentToolRegistry(), permissionMode: "read_only", modelTimeoutMs: 10,
    requestUserInput: input => broker.request(input, controller.signal),
    model: { async complete() { calls += 1; return { toolCalls: [{ id: "waiting-question", name: AGENT_USER_INPUT_TOOL_NAME, arguments: question }] }; } },
  }).run({ prompt: "ask", runId: owner.runId, signal: controller.signal });
  let completed = false;
  running.then(() => { completed = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(broker.pendingQuestion);
  assert.equal(completed, false, "the 10 ms model deadline must not time out human input");
  controller.abort();
  const result = await running;
  assert.equal(result.status, "cancelled");
  assert.equal(calls, 1);
  assert.equal(broker.pendingQuestion, undefined);
});

test("cancelled or expired questions pause the runner without side effects or queue drain", async () => {
  for (const status of ["cancelled", "expired"] as const) {
    let effects = 0;
    let drains = 0;
    const tools = new AgentToolRegistry();
    tools.register({ name: "test.write", description: "write", source: "builtin", requiredPermission: "workspace_write", inputSchema: {} }, async () => {
      effects += 1;
      return { modelOutput: {}, summary: { title: "write" } };
    });
    const result = await new AgentRunner({
      tools, permissionMode: "workspace_write", requestUserInput: async () => ({ status }),
      takeSteeringMessages: () => { drains += 1; return []; },
      model: { async complete() { return { toolCalls: [
        { id: "question-tool-call", name: AGENT_USER_INPUT_TOOL_NAME, arguments: question },
        { id: "after-question-write", name: "test.write", arguments: {} },
      ] }; } },
    }).run({ prompt: "ask first", runId: owner.runId });
    assert.equal(result.status, "paused");
    assert.equal(result.stopReason, `user_input_${status}`);
    assert.equal(effects, 0);
    assert.equal(drains, 0);
    assert.equal(result.checkpoint!.messages.filter(message => message.role === "tool").length, 2);
  }
});

test("a clarification answer cannot approve a restricted tool and unavailable hosts fall back to text", async () => {
  let effects = 0;
  let calls = 0;
  const tools = new AgentToolRegistry();
  tools.register({ name: "test.restricted", description: "restricted", source: "builtin", requiredPermission: "full_access", inputSchema: {} }, async () => {
    effects += 1;
    return { modelOutput: {}, summary: { title: "restricted" } };
  });
  const result = await new AgentRunner({
    tools, permissionMode: "read_only", requestUserInput: async () => ({ status: "answered", answer: { text: "yes" } }),
    model: { async complete() { calls += 1; return calls === 1 ? { toolCalls: [
      { id: "question-tool-call", name: AGENT_USER_INPUT_TOOL_NAME, arguments: question },
    ] } : calls === 2 ? { toolCalls: [{ id: "restricted-call", name: "test.restricted", arguments: {} }] }
      : { content: "restricted tool remains denied" }; } },
  }).run({ prompt: "ask safely", runId: owner.runId });
  assert.equal(result.status, "completed");
  assert.equal(effects, 0);
  assert.ok(result.events.some(event => event.type === "tool_completed" && event.toolName === "test.restricted" && !event.ok));
  for (const allowedToolNames of [undefined, ["task.update_plan"]]) {
    let advertised = false;
    const fallback = await new AgentRunner({
      tools: new AgentToolRegistry(), permissionMode: "read_only", allowedToolNames,
      ...(allowedToolNames ? { requestUserInput: async () => { assert.fail("Excluded question tool executed"); } } : {}),
      model: { async complete(request) { advertised = request.tools.some(tool => tool.name === AGENT_USER_INPUT_TOOL_NAME); return { content: "请告诉我你的选择？" }; } },
    }).run({ prompt: "ask", runId: owner.runId });
    assert.equal(advertised, false);
    assert.equal(fallback.finalText, "请告诉我你的选择？");
  }
});

test("questions are hard serial barriers even if a shadow registry descriptor advertises concurrency", async () => {
  const broker = new AgentUserInputBroker(owner);
  const tools = new AgentToolRegistry();
  let effects = 0;
  for (const name of [AGENT_USER_INPUT_TOOL_NAME, "test.preplanned_write"]) {
    tools.register({ name, description: "shadow", source: "builtin", requiredPermission: "read_only", concurrencySafe: true, inputSchema: {} }, async () => {
      effects += 1;
      return { modelOutput: {}, summary: { title: "effect" } };
    });
  }
  let calls = 0;
  let replanned: AgentModelRequest | undefined;
  const running = new AgentRunner({
    tools, permissionMode: "read_only", requestUserInput: input => broker.request(input),
    model: { async complete(request) {
      calls += 1;
      if (calls === 1) return { toolCalls: [
        { id: "serial-question", name: AGENT_USER_INPUT_TOOL_NAME, arguments: question },
        { id: "preplanned-effect", name: "test.preplanned_write", arguments: {} },
      ] };
      replanned = request;
      return { content: "用户否决了预先计划的动作，没有执行" };
    } },
  }).run({ prompt: "ask before action", runId: owner.runId });
  await tick();
  assert.equal(effects, 0);
  broker.answer({ ...broker.pendingQuestion!, text: "No, do not change files" });
  assert.equal((await running).status, "completed");
  assert.equal(effects, 0, "pre-answer plans must be reevaluated, never blindly executed");
  const skipped = replanned!.messages.find(message => message.toolCallId === "preplanned-effect");
  assert.equal(JSON.parse(skipped!.content).error.code, "USER_QUESTION_REQUIRES_REPLAN");
});

for (const kind of ["invalid", "unavailable"] as const) {
  test(`an ${kind} question still blocks every subsequent preplanned action`, async () => {
    const tools = new AgentToolRegistry();
    let effects = 0;
    let calls = 0;
    let correction: AgentModelRequest | undefined;
    tools.register({ name: "test.write", description: "write", source: "builtin", requiredPermission: "workspace_write", inputSchema: {} }, async () => {
      effects += 1;
      return { modelOutput: {}, summary: { title: "write" } };
    });
    const result = await new AgentRunner({
      tools, permissionMode: "workspace_write",
      ...(kind === "invalid" ? { requestUserInput: async () => { assert.fail("Invalid question must not reach the host"); } } : {}),
      model: { async complete(request) {
        calls += 1;
        if (calls === 1) return { toolCalls: [
          { id: "bad-question", name: AGENT_USER_INPUT_TOOL_NAME, arguments: kind === "invalid" ? { prompt: "" } : question },
          { id: "unsafe-preplan", name: "test.write", arguments: {} },
        ] };
        correction = request;
        return { content: "请先回答问题，我没有执行预先安排的操作。" };
      } },
    }).run({ prompt: "ask before action", runId: owner.runId });
    assert.equal(effects, 0);
    assert.equal(result.status, "completed");
    const outputs = correction!.messages.filter(message => message.role === "tool").map(message => JSON.parse(message.content));
    assert.equal(outputs.length, 2, "all requested calls must remain paired with a result");
    assert.equal(outputs[0].error.code, kind === "invalid" ? "INVALID_USER_QUESTION" : "USER_INPUT_UNAVAILABLE");
    assert.equal(outputs[1].error.code, "USER_QUESTION_REQUIRES_REPLAN");
  });
}
