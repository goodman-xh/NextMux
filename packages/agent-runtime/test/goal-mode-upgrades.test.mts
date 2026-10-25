import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TASK_GOAL_TOOL_NAME,
  AgentRunner,
  AgentToolRegistry,
  createAgentTaskContext,
  rebaseAgentRunCheckpoint,
  type AgentRunEvent,
  type AgentSteeringMessage,
} from "../lib/index.js";

function createToolsWithEcho(): AgentToolRegistry {
  const tools = new AgentToolRegistry();
  tools.register(
    {
      name: "workspace.echo",
      description: "Echo text for testing.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" } },
      },
      requiredPermission: "read_only",
      source: "builtin",
    },
    async (args) => ({
      modelOutput: { echoed: (args as { text?: string })?.text ?? "" },
      summary: { kind: "tool.completed", title: "Echoed text" },
    }),
  );
  return tools;
}

const GOAL_PROMPT = `Persistent goal mode is active for this conversation.

<objective>
Implement and verify feature X
</objective>`;

test("task.update_goal tool emits goal_status events and returns mandatory wrap-up instruction", async () => {
  const tools = createToolsWithEcho();
  const events: AgentRunEvent[] = [];
  let step = 0;

  const result = await new AgentRunner({
    tools,
    permissionMode: "read_only",
    onEvent: (event) => { events.push(event); },
    model: {
      complete: async (request) => {
        step += 1;
        assert.ok(
          request.tools?.some((tool) => tool.name === AGENT_TASK_GOAL_TOOL_NAME || tool.name === "task_update_goal"),
          "task.update_goal must be exposed in built-in tool definitions",
        );
        if (step === 1) {
          return {
            toolCalls: [
              {
                id: "goal-progress-1",
                name: AGENT_TASK_GOAL_TOOL_NAME,
                arguments: {
                  status: "in_progress",
                  summary: " Halfway through verification ",
                },
              },
            ],
          };
        }
        if (step === 2) {
          const prevToolMsg = request.messages.find(
            (m) => m.role === "tool" && m.toolCallId === "goal-progress-1",
          );
          assert.ok(prevToolMsg);
          const parsedProgress = JSON.parse(prevToolMsg.content);
          assert.equal(parsedProgress.ok, true);
          assert.equal(parsedProgress.output.status, "in_progress");
          assert.equal(parsedProgress.output.summary, "Halfway through verification");
          assert.match(parsedProgress.output.instruction, /Continue executing the next concrete step/);
          return {
            toolCalls: [
              {
                id: "goal-done-1",
                name: AGENT_TASK_GOAL_TOOL_NAME,
                arguments: {
                  status: "completed",
                  summary: "All tests pass",
                },
              },
            ],
          };
        }
        const doneToolMsg = request.messages.find(
          (m) => m.role === "tool" && m.toolCallId === "goal-done-1",
        );
        assert.ok(doneToolMsg);
        const parsedDone = JSON.parse(doneToolMsg.content);
        assert.equal(parsedDone.ok, true);
        assert.equal(parsedDone.output.status, "completed");
        assert.match(parsedDone.output.instruction, /GOAL_COMPLETE/);
        return {
          content: "Feature X is implemented and verified.\n[GOAL_COMPLETE]",
        };
      },
    },
  }).run({ prompt: GOAL_PROMPT, runId: "goal-tool-run-001" });

  assert.equal(result.status, "completed");
  assert.equal(step, 3, "completed status must not trigger an extra continuation nudge");
  const completedGoalEvents = events.filter(
    (e) => e.type === "tool_completed" && e.toolName === AGENT_TASK_GOAL_TOOL_NAME,
  );
  assert.equal(completedGoalEvents.length, 2);
});

test("task.update_goal exists only while a persistent goal is active", async () => {
  let step = 0;
  const result = await new AgentRunner({
    tools: createToolsWithEcho(),
    permissionMode: "read_only",
    model: {
      complete: async (request) => {
        step += 1;
        assert.ok(!request.tools?.some((tool) => tool.name === AGENT_TASK_GOAL_TOOL_NAME), "no goal tool without an <objective>");
        if (step === 1) return { toolCalls: [{ id: "stray-goal", name: AGENT_TASK_GOAL_TOOL_NAME, arguments: { status: "completed", summary: "done" } }] };
        const reply = JSON.parse(request.messages.find((message) => message.toolCallId === "stray-goal")!.content);
        assert.equal(reply.ok, false);
        assert.equal(reply.error.code, "NO_ACTIVE_GOAL");
        return { content: "Plain answer." };
      },
    },
  }).run({ prompt: "Explain feature X", runId: "goal-tool-run-000" });
  assert.equal(result.status, "completed");
});

test("in-run goal continuation hook nudges once when model stops early without marker or question", async () => {
  const tools = createToolsWithEcho();
  let step = 0;

  const result = await new AgentRunner({
    tools,
    permissionMode: "read_only",
    model: {
      complete: async (request) => {
        step += 1;
        if (step === 1) {
          return {
            content: "I have inspected the repository structure and will now proceed.",
          };
        }
        assert.match(
          request.messages.at(-1)?.content ?? "",
          /active persistent goal \(<objective>\), and your reply stopped without calling any tool/,
        );
        return {
          content: "Completed all remaining steps.\n**[GOAL_COMPLETE]**",
        };
      },
    },
  }).run({ prompt: GOAL_PROMPT, runId: "goal-nudge-run-001" });

  assert.equal(result.status, "completed");
  assert.equal(step, 2);

  // Stopping with a direct question to the user should not trigger the automatic nudge.
  let questionSteps = 0;
  await new AgentRunner({
    tools,
    permissionMode: "read_only",
    model: {
      complete: async () => {
        questionSteps += 1;
        return {
          content: "Which target environment should I deploy to?",
        };
      },
    },
  }).run({ prompt: GOAL_PROMPT, runId: "goal-question-no-nudge" });
  assert.equal(questionSteps, 1);
});

test("duplicate goal_update steering messages are deduplicated and live goal edits reset completion state", async () => {
  const tools = createToolsWithEcho();
  const events: AgentRunEvent[] = [];
  const steeringQueue: AgentSteeringMessage[] = [
    {
      id: "steer-dup-1",
      kind: "goal_update",
      content: "Updated objective v2",
      createdAt: "2026-10-22T00:00:01.000Z",
    },
    {
      id: "steer-dup-2",
      kind: "goal_update",
      content: "Updated objective v2",
      createdAt: "2026-10-22T00:00:02.000Z",
    },
    {
      id: "steer-user-1",
      kind: "direction",
      content: "Also ensure backwards compatibility with Node 24.",
      createdAt: "2026-10-22T00:00:03.000Z",
    },
  ];

  let step = 0;
  await new AgentRunner({
    tools,
    permissionMode: "read_only",
    onEvent: (e) => { events.push(e); },
    takeSteeringMessages: () => (step === 1 ? steeringQueue.splice(0) : []),
    model: {
      complete: async (request) => {
        step += 1;
        if (step === 1) {
          return {
            toolCalls: [
              {
                id: "call-complete-old",
                name: AGENT_TASK_GOAL_TOOL_NAME,
                arguments: { status: "completed", summary: "Finished v1" },
              },
            ],
          };
        }
        if (step === 2) {
          assert.match(request.instructions ?? "", /Updated objective v2/);
          assert.match(
            request.instructions ?? "",
            /address the user's latest direction immediately while keeping the active <objective> in effect/,
          );
          // Because goal_update arrived after step 1's completed status, stopping without completing v2 must nudge once.
          return { content: "Acknowledged v2 update, starting work." };
        }
        return { content: "Finished v2 with Node 24 support.\n`[GOAL_COMPLETE]`" };
      },
    },
  }).run({ prompt: GOAL_PROMPT, runId: "goal-steer-dedup-run" });

  assert.equal(step, 3, "live goal edit must reset goalStatusReported and allow continuation nudge for v2");
  const goalSteeringApplied = events.filter(
    (e) => e.type === "steering_applied" && e.message.kind === "goal_update",
  );
  assert.equal(goalSteeringApplied.length, 1, "identical goal_update messages must be deduplicated");
});

test("continuedTaskAnchor preserves active <objective> when user sends an extra direction turn", async () => {
  const tools = createToolsWithEcho();
  const first = await new AgentRunner({
    tools,
    permissionMode: "read_only",
    captureCheckpoint: true,
    taskContext: createAgentTaskContext({
      workspaceRoot: "/tmp/workspace",
      permissionMode: "read_only",
      goal: GOAL_PROMPT,
      allowedToolNames: ["workspace.echo"],
    }),
    model: {
      complete: async () => ({ content: "Step 1 done.\n[GOAL_COMPLETE]" }),
    },
  }).run({ prompt: GOAL_PROMPT, runId: "goal-anchor-001" });

  const rebased = rebaseAgentRunCheckpoint(first.checkpoint!, {
    runId: "goal-anchor-002",
    direction: "Also add unit tests for edge case Z",
  });

  const second = await new AgentRunner({
    tools,
    permissionMode: "read_only",
    captureCheckpoint: true,
    model: {
      complete: async (request) => {
        assert.match(
          request.instructions ?? "",
          /address the user's latest direction immediately while keeping the active <objective> in effect/,
        );
        return { content: "Added unit tests for edge case Z.\n[GOAL_COMPLETE]" };
      },
    },
  }).run({
    prompt: "Also add unit tests for edge case Z",
    checkpoint: rebased,
  });

  assert.equal(second.status, "completed");
  assert.match(second.checkpoint?.taskAnchor?.content ?? "", /<objective>\nImplement and verify feature X\n<\/objective>/);
  assert.match(second.checkpoint?.taskAnchor?.content ?? "", /Also add unit tests for edge case Z/);
});
