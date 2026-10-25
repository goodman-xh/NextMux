#!/usr/bin/env node

import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";

if (process.env.ACP_TEST_PID_FILE) {
  await writeFile(process.env.ACP_TEST_PID_FILE, String(process.pid), "utf8");
}

if (process.env.ACP_TEST_GRANDCHILD_PID_FILE) {
  const grandchild = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000);",
  ], { stdio: "ignore" });
  await writeFile(process.env.ACP_TEST_GRANDCHILD_PID_FILE, String(grandchild.pid), "utf8");
}

const sessions = new Map();
let clientCapabilities = {};

const notify = (client, sessionId, update) => client.notify(acp.methods.client.session.update, {
  sessionId,
  update,
});

const app = acp
  .agent({ name: "nextmux-acp-test-agent" })
  .onRequest(acp.methods.agent.initialize, ({ params }) => {
    clientCapabilities = params.clientCapabilities ?? {};
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: "NextMux ACP fixture", version: "1.0.0" },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
          audio: true,
          embeddedContext: true,
        },
      },
    };
  })
  .onRequest(acp.methods.agent.session.new, () => {
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { controller: undefined });
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);

    session.controller?.abort();
    const controller = new AbortController();
    session.controller = controller;

    const text = params.prompt
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n");

    if (text.includes("MEDIA_CONTEXT_FIXTURE")) {
      await notify(client, params.sessionId, { sessionUpdate: "agent_message_chunk", content: {
        type: "text", text: JSON.stringify({ context: text,
          images: params.prompt.filter(block => block.type === "image").length,
          audio: params.prompt.filter(block => block.type === "audio").length }),
      } });
      return { stopReason: "end_turn" };
    }

    if (text.includes("WAIT_FOR_CANCEL")) {
      await notify(client, params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "waiting for cancellation" },
      });
      await new Promise(resolve => controller.signal.addEventListener("abort", resolve, { once: true }));
      return { stopReason: "cancelled" };
    }

    if (text.includes("WAIT_FOREVER")) {
      await notify(client, params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "waiting forever until force-stopped" },
      });
      await new Promise(() => undefined);
    }

    if (text.includes("COMPLETE_WITH_OPEN_TOOL")) {
      await notify(client, params.sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "left-open",
        title: "Tool left open by agent",
        name: "fixture.open_tool",
        kind: "other",
        status: "in_progress",
      });
      await notify(client, params.sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Stopping with an open tool." },
      });
      return { stopReason: "end_turn" };
    }

    await notify(client, params.sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "读取 packages/agent-runtime/src/runner.ts", priority: "high", status: "completed" },
        { content: "找到 57 处匹配", priority: "high", status: "completed" },
        { content: "rg 退出码 0", priority: "high", status: "completed" },
        { content: "Read, write, and verify through the ACP host", priority: "high", status: "in_progress" },
      ],
    });

    await notify(client, params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Inspecting the workspace. " },
    });

    await notify(client, params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "read-input",
      title: "Read input.txt",
      name: "fs.read_text_file",
      kind: "read",
      status: "in_progress",
      locations: [{ path: `${params.prompt[0]?._meta?.workspaceRoot ?? ""}/input.txt` }],
    });
    const inputPath = new URL("input.txt", process.env.ACP_TEST_WORKSPACE_URL).pathname;
    const read = await client.request(acp.methods.client.fs.readTextFile, {
      sessionId: params.sessionId,
      path: decodeURIComponent(inputPath).replace(/^\/(?:([A-Za-z]:))/, "$1"),
    });
    await notify(client, params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "read-input",
      title: "Read input.txt",
      status: "completed",
    });

    const permission = await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: "write-output",
        title: "Write output.txt",
        name: "fs.write_text_file",
        kind: "edit",
        status: "pending",
      },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    });

    if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== "allow-once") {
      return { stopReason: "refusal" };
    }

    await notify(client, params.sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "write-output",
      title: "Write output.txt",
      name: "fs.write_text_file",
      kind: "edit",
      status: "in_progress",
    });
    const outputPath = new URL("output.txt", process.env.ACP_TEST_WORKSPACE_URL).pathname;
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId: params.sessionId,
      path: decodeURIComponent(outputPath).replace(/^\/(?:([A-Za-z]:))/, "$1"),
      content: `copied:${read.content}`,
    });
    await notify(client, params.sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "write-output",
      title: "Write output.txt",
      status: "completed",
    });

    let terminalOutput = "terminal-disabled";
    if (clientCapabilities.terminal) {
      await notify(client, params.sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "terminal-check",
        title: "Run terminal check",
        name: "terminal.create",
        kind: "execute",
        status: "in_progress",
      });
      const created = await client.request(acp.methods.client.terminal.create, {
        sessionId: params.sessionId,
        command: process.execPath,
        args: ["--version"],
      });
      await client.request(acp.methods.client.terminal.waitForExit, {
        sessionId: params.sessionId,
        terminalId: created.terminalId,
      });
      const terminal = await client.request(acp.methods.client.terminal.output, {
        sessionId: params.sessionId,
        terminalId: created.terminalId,
      });
      await client.request(acp.methods.client.terminal.release, {
        sessionId: params.sessionId,
        terminalId: created.terminalId,
      });
      terminalOutput = terminal.output;
      await notify(client, params.sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "terminal-check",
        title: "Run terminal check",
        status: "completed",
      });
    }

    const imageCount = params.prompt.filter(block => block.type === "image").length;
    const resourceCount = params.prompt.filter(block => block.type === "resource").length;
    await notify(client, params.sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: `Done: ${read.content.trim()}; ${terminalOutput.trim()}; images=${imageCount}; resources=${resourceCount}`,
      },
    });

    return {
      stopReason: "end_turn",
      usage: { totalTokens: 12, inputTokens: 7, outputTokens: 5 },
    };
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    sessions.get(params.sessionId)?.controller?.abort();
  });

const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);
const connection = app.connect(stream);
await connection.closed;
