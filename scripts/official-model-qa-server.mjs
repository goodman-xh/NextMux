#!/usr/bin/env node

import http from "node:http";
import { deflateSync } from "node:zlib";
import { observeQaRequest, toolContractFixturePath } from "./official-model-qa-fixture.mjs";

const port = Number(process.env.NEXTMUX_OFFICIAL_QA_PORT || 4181);
const expectedKey = process.env.NEXTMUX_OFFICIAL_QA_KEY || "nextmux-qa-secret";
// The product's dedicated local-model transport intentionally strips credentials.
// Permit that only for an explicitly disposable, loopback-only desktop fixture.
function authenticatedQaRequest(request) {
  return request.headers.authorization === `Bearer ${expectedKey}`
    || process.env.NEXTMUX_DESKTOP_E2E_ISOLATED === "1"
      && process.env.NEXTMUX_QA_ALLOW_LOCAL_NO_AUTH === "1"
      && request.headers.authorization === undefined
      && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress);
}
const qaModel = process.env.NEXTMUX_QA_MODEL || "gpt-5.6-sol";
const qaSecondaryModel = process.env.NEXTMUX_QA_SECONDARY_MODEL || "gpt-nextmux-qa-secondary";
const responseDelayMs = Math.max(0, Math.min(10_000, Number(process.env.NEXTMUX_OFFICIAL_QA_DELAY_MS || 0)));
const maximumBodyBytes = 1024 * 1024;
const transientFailureMarkers = new Set();
const recoveryQaStates = new Map();
const rateLimitQaStates = new Map();
const delegationQaStates = new Map();

function rateLimitQaState(marker) {
  if (!rateLimitQaStates.has(marker)) {
    rateLimitQaStates.set(marker, {
      marker,
      requests: 0,
      rateLimitResponses: 0,
      processRequests: 0,
      readRequests: 0,
    });
  }
  return rateLimitQaStates.get(marker);
}

function delegationQaState(marker) {
  if (!delegationQaStates.has(marker)) {
    delegationQaStates.set(marker, {
      marker,
      parentModelCalls: 0,
      childModelCalls: 0,
      activeChildModelRuns: 0,
      childPermissionRequest: "",
      childWorkspaceListExposed: false,
      childProcessToolExposed: false,
      childWriteToolExposed: false,
      childProcessToolCalls: 0,
      parentReceivedChildResult: false,
      parentArtifactVerified: false,
      childFailureReturned: false,
      childContinuationCalls: 0,
      childContinuationReceived: false,
    });
  }
  return delegationQaStates.get(marker);
}

function providerTool(tools, logicalName) {
  const readableSuffix = logicalName.replace(/[^A-Za-z0-9_-]+/g, "_");
  return tools.find(tool => {
    const name = tool?.function?.name;
    return name === logicalName || (typeof name === "string" && name.endsWith(`_${readableSuffix}`));
  });
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n");
}

function messageHasImage(content) {
  return Array.isArray(content) && content.some(part => part?.type === "image_url"
    && (typeof part.image_url === "string" || typeof part.image_url?.url === "string"));
}

function reply(response, status, payload) {
  const body = JSON.stringify(payload);
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  };
  if (responseDelayMs) setTimeout(send, responseDelayMs);
  else send();
}

function replyRateLimited(response, marker) {
  const requestId = `qa-rate-limit-${marker}`;
  const payload = {
    error: {
      type: "rate_limit_error",
      code: "rate_limit",
      // Keep the exact wrapper shape seen from common provider SDKs.  The
      // desktop transport must classify this from both status and message,
      // while never surfacing the raw provider body as an unbounded error.
      message: `exceeded retry limit, last status: 429 Too Many Requests, request id: ${requestId}`,
    },
  };
  const body = JSON.stringify(payload);
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(429, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "retry-after": "1",
      "x-request-id": requestId,
    });
    response.end(body);
  };
  if (responseDelayMs) setTimeout(send, responseDelayMs);
  else send();
}

function replyBinary(response, status, contentType, payload) {
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(status, {
      "content-type": contentType,
      "content-length": payload.byteLength,
    });
    response.end(payload);
  };
  if (responseDelayMs) setTimeout(send, responseDelayMs);
  else send();
}

function replyOpenAIStream(response, model, message) {
  const send = () => {
    if (response.destroyed) return;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const write = payload => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    const base = { id: "nextmux-official-qa", object: "chat.completion.chunk", model };
    write({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
    const progress = typeof message.content === "string" && message.content
      ? message.content
      : message.tool_calls?.length ? "正在验证工作区与工具调用。" : "";
    if (progress) {
      const middle = Math.max(1, Math.ceil(progress.length / 2));
      write({ ...base, choices: [{ index: 0, delta: { content: progress.slice(0, middle) }, finish_reason: null }] });
      write({ ...base, choices: [{ index: 0, delta: { content: progress.slice(middle) }, finish_reason: null }] });
    }
    if (message.tool_calls?.length) {
      write({
        ...base,
        choices: [{
          index: 0,
          delta: {
            tool_calls: message.tool_calls.map((call, index) => ({
              index,
              id: call.id,
              type: "function",
              function: { name: call.function.name, arguments: call.function.arguments },
            })),
          },
          finish_reason: null,
        }],
      });
    }
    write({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 21, completion_tokens: 6, total_tokens: 27 },
    });
    response.end("data: [DONE]\n\n");
  };
  if (responseDelayMs) setTimeout(send, responseDelayMs);
  else send();
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function qaPng(width = 640, height = 360) {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const stripe = Math.abs(x - (y * width) / height) < 18;
      rows[offset] = stripe ? 190 : 28 + Math.floor((x / width) * 24);
      rows[offset + 1] = stripe ? 61 : 31 + Math.floor((y / height) * 22);
      rows[offset + 2] = stripe ? 108 : 38 + Math.floor((x / width) * 18);
      rows[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function qaWav() {
  const sampleRate = 16_000;
  const samples = Math.floor(sampleRate * 0.45);
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 300, (samples - index) / 300);
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 4_500 * envelope);
    wav.writeInt16LE(value, 44 + index * 2);
  }
  return wav;
}

const imageFixture = qaPng();
const speechFixture = qaWav();

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  observeQaRequest(request, response, url.pathname);
  if (request.method === "GET" && url.pathname === "/health") {
    reply(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/__nextmux_qa/delegation") {
    const marker = url.searchParams.get("marker") || "";
    const state = delegationQaStates.get(marker);
    reply(response, state ? 200 : 404, state || { error: { message: "delegation QA state not found" } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/__nextmux_qa/rate-limit") {
    const marker = url.searchParams.get("marker") || "";
    const state = rateLimitQaStates.get(marker);
    reply(response, state ? 200 : 404, state || { error: { message: "rate-limit QA state not found" } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/__nextmux_qa/recovery") {
    const state = recoveryQaStates.get(url.searchParams.get("marker") || "");
    reply(response, state ? 200 : 404, state || { error: { message: "recovery QA state not found" } });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    if (!authenticatedQaRequest(request)) {
      if (process.env.NEXTMUX_DESKTOP_E2E_ISOLATED === "1") console.error(JSON.stringify({ event: "qa_auth_rejected", path: url.pathname, present: typeof request.headers.authorization === "string", receivedLength: request.headers.authorization?.length || 0, expectedLength: expectedKey.length + 7 }));
      reply(response, 401, { error: { message: "invalid key" } });
      return;
    }
    reply(response, 200, {
      object: "list",
      data: [qaModel, qaSecondaryModel].map(id => ({ id, object: "model", owned_by: "nextmux-qa" })),
    });
    return;
  }
  const supportedPostPath = url.pathname === "/v1/chat/completions"
    || url.pathname === "/v1/images/generations"
    || url.pathname === "/v1/audio/speech";
  if (request.method !== "POST" || !supportedPostPath) {
    reply(response, 404, { error: { message: "not found" } });
    return;
  }
  if (!authenticatedQaRequest(request)) {
      if (process.env.NEXTMUX_DESKTOP_E2E_ISOLATED === "1") console.error(JSON.stringify({ event: "qa_auth_rejected", path: url.pathname, present: typeof request.headers.authorization === "string", receivedLength: request.headers.authorization?.length || 0, expectedLength: expectedKey.length + 7 }));
    reply(response, 401, { error: { message: "invalid key" } });
    return;
  }
  const chunks = [];
  let size = 0;
  request.on("data", chunk => {
    size += chunk.length;
    if (size > maximumBodyBytes) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", () => {
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reply(response, 400, { error: { message: "invalid json" } });
      return;
    }
    if (url.pathname === "/v1/images/generations") {
      if (typeof body.model !== "string" || typeof body.prompt !== "string" || body.response_format !== "b64_json") {
        reply(response, 422, { error: { message: "invalid image QA request" } });
        return;
      }
      reply(response, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: imageFixture.toString("base64"), revised_prompt: "NextMux local QA fixture" }],
      });
      return;
    }
    if (url.pathname === "/v1/audio/speech") {
      if (typeof body.model !== "string" || typeof body.input !== "string" || typeof body.voice !== "string") {
        reply(response, 422, { error: { message: "invalid speech QA request" } });
        return;
      }
      replyBinary(response, 200, "audio/wav", speechFixture);
      return;
    }
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some(message => message?.role === "tool");
    const connectionTool = providerTool(tools, "nextmux_connection_check");
    const workspaceTool = providerTool(tools, "workspace.list_files");
    const workspaceReadTool = providerTool(tools, "workspace.read_file");
    const workspacePatchTool = providerTool(tools, "workspace.apply_patch");
    const workspaceWriteTool = providerTool(tools, "workspace.write_file");
    const processTool = providerTool(tools, "process.run");
    const processStartTool = providerTool(tools, "process.start");
    const processReadTool = providerTool(tools, "process.read");
    const processWriteTool = providerTool(tools, "process.write");
    const processTerminateTool = providerTool(tools, "process.terminate");
    const taskPlanTool = providerTool(tools, "task.update_plan");
    const comicReadTool = providerTool(tools, "comic.get_project");
    const comicAddShotTool = providerTool(tools, "comic.add_shot");
    const delegateTool = providerTool(tools, "agent.delegate");
    if (comicReadTool && workspaceWriteTool) {
      reply(response, 422, { error: { message: "comic workbench exposed generic workspace.write_file" } });
      return;
    }
    const lastAssistantToolCall = [...messages].reverse().find(message =>
      message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0
    )?.tool_calls?.[0];
    const lastToolMessage = [...messages].reverse().find(message => message?.role === "tool");
    const lastUserMessage = [...messages].reverse().find(message => message?.role === "user");
    const lastUserText = messageText(lastUserMessage?.content);
    const marketingEnglish = /NM_MARKETING_DEMO_EN/i.test(lastUserText);
    const contractCopy = marketingEnglish ? {
      start: "I’ll organize the work into a short, verifiable plan before changing the demo workspace.",
      inspect: "Inspecting the workspace before creating and validating the routing file.",
      baseline: "Workspace baseline confirmed. Moving to the file creation step.",
      create: "Creating the routing file now.",
      read: "File created. Reading its content and SHA-256 checksum.",
      patch: "Content and checksum verified. Applying one precise patch.",
      verify: "Patch applied. Verifying the updated file.",
      inventory: "File verification complete. Checking the final workspace artifacts.",
      finishPlan: "Implementation and verification are complete. Finalizing the plan and summary.",
      complete: "Created, read, precisely edited, and verified the routing file successfully.",
      steps: ["Inspect workspace", "Create routing file", "Read and verify file", "Apply precise patch", "Verify result", "Summarize changes"],
    } : {
      start: "我先建立可验证的任务计划，再开始工作区操作。",
      inspect: "先检查工作区根目录，再创建并验证目标文件。",
      baseline: "基线已经确认，正在进入文件创建阶段。",
      create: "目录已经确认，正在创建回归文件。",
      read: "文件已经创建，正在读取内容与 SHA-256。",
      patch: "文件与校验值已确认，正在应用精确补丁。",
      verify: "补丁已经应用，正在复查修改后的文件。",
      inventory: "文件内容复查完成，正在确认产物目录。",
      finishPlan: "实现与验证均已完成，正在固化任务计划并输出总结。",
      complete: "文件创建、读取、精确修改、复查与产物确认均已完成。",
      steps: ["检查工作区基线", "创建回归文件", "读取并校验文件", "应用精确补丁", "复查产物与执行记录", "输出完成总结"],
    };
    const lastUserHasImage = messageHasImage(lastUserMessage?.content);
    const delegationMarker = lastUserText.match(/NM_AGENT_DELEGATION_E2E_[0-9a-f-]+/i)?.[0];
    const delegationChildMarker = lastUserText.match(/NM_AGENT_DELEGATION_CHILD_E2E_[0-9a-f-]+/i)?.[0];
    const delegationChildResultMarker = lastUserText.match(/NM_AGENT_DELEGATION_CHILD_RESULT_[0-9a-f-]+/i)?.[0];
    const delegationFailureMarker = lastUserText.match(/NM_AGENT_DELEGATION_FAILURE_E2E_[0-9a-f-]+/i)?.[0];
    const delegationChildContinuationMarker = lastUserText.match(/NM_AGENT_DELEGATION_CHILD_CONTINUE_E2E_[0-9a-f-]+/i)?.[0];
    const rateLimitMarker = lastUserText.match(/NM_RATE_LIMIT_E2E_[0-9a-f-]+/i)?.[0];
    const delegationState = delegationMarker ? delegationQaState(delegationMarker) : undefined;
    const rateLimitState = rateLimitMarker ? rateLimitQaState(rateLimitMarker) : undefined;
    if (rateLimitState) rateLimitState.requests += 1;
    const recoveryMarker = lastUserText.match(/NM_AUTO_RESUME_E2E_\d+/)?.[0];
    if (recoveryMarker && !recoveryQaStates.has(recoveryMarker)) recoveryQaStates.set(recoveryMarker, {
      marker: recoveryMarker, requests: 0, unavailableResponses: 0, processRequests: 0, readRequests: 0,
    });
    const recoveryState = recoveryQaStates.get(recoveryMarker);
    if (recoveryState) recoveryState.requests += 1;
    if (delegationState) {
      if (delegateTool) delegationState.parentModelCalls += 1;
      else if (delegationChildMarker || delegationFailureMarker || delegationChildContinuationMarker) {
        delegationState.childModelCalls += 1;
        delegationState.childWorkspaceListExposed ||= Boolean(workspaceTool);
        delegationState.childProcessToolExposed ||= Boolean(processTool || processStartTool);
        delegationState.childWriteToolExposed ||= Boolean(workspaceWriteTool || workspacePatchTool);
        if (processTool && lastAssistantToolCall?.function?.name === processTool.function.name) {
          delegationState.childProcessToolCalls += 1;
        }
      }
    }
    let lastToolPayload;
    let lastToolOutput;
    try {
      lastToolPayload = JSON.parse(lastToolMessage?.content || "null");
      lastToolOutput = lastToolPayload?.output;
    } catch {
      lastToolPayload = undefined;
      lastToolOutput = undefined;
    }
    const toolOutputs = messages.filter(candidate => candidate?.role === "tool").flatMap(candidate => {
      try {
        const output = JSON.parse(candidate?.content || "null")?.output;
        return output ? [output] : [];
      } catch {
        return [];
      }
    });
    // This fixture deliberately fails only after the command has completed.
    // The next model request must resume from the opaque checkpoint instead
    // of replaying the side effect.  A local QA server state makes that
    // guarantee observable without touching the user's real workspace.
    if (rateLimitMarker && processTool && lastAssistantToolCall?.function?.name === processTool.function.name
      && hasToolResult && !rateLimitState.rateLimitResponses) {
      rateLimitState.rateLimitResponses += 1;
      replyRateLimited(response, rateLimitMarker);
      return;
    }
    let message;
    if (connectionTool) {
      message = {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "qa-connection-check-1",
          type: "function",
          function: { name: connectionTool.function.name, arguments: "{\"code\":\"OK\"}" },
        }],
      };
    } else if (/NM_IMAGE_E2E_\d+/i.test(lastUserText)) {
      if (!lastUserHasImage) {
        reply(response, 422, { error: { message: "image QA request did not contain an image_url part" } });
        return;
      }
      message = { role: "assistant", content: lastUserText.match(/NM_IMAGE_E2E_\d+/i)?.[0] || "NM_IMAGE_E2E_OK" };
    } else if (/NM_LONG_PASTE_E2E_REQUEST_\d+/i.test(lastUserText)) {
      const requestMarker = lastUserText.match(/NM_LONG_PASTE_E2E_REQUEST_\d+/i)?.[0] || "NM_LONG_PASTE_E2E_OK";
      const bodyMarker = lastUserText.match(/NM_LONG_PASTE_E2E_BODY_\d+/i)?.[0];
      const hasNamedTextAttachment = /<file name="pasted-text-[^"]+\.txt">[\s\S]*<\/file>/i.test(lastUserText);
      if (bodyMarker && !hasNamedTextAttachment) {
        reply(response, 422, { error: { message: "long-paste QA request did not contain a named text attachment" } });
        return;
      }
      if (!bodyMarker && hasNamedTextAttachment) {
        reply(response, 422, { error: { message: "edited long-paste QA request retained a removed text attachment" } });
        return;
      }
      message = {
        role: "assistant",
        content: bodyMarker ? requestMarker : `${requestMarker}_EDITED_NO_ATTACHMENT`,
      };
    } else if (delegationState && !delegateTool && delegationChildContinuationMarker
      && lastUserText.includes(delegationChildContinuationMarker)) {
      // A completed child is resumed through the private checkpoint, not by
      // replaying its old tool call. Return a fresh assistant turn so the E2E
      // proves the new prompt reached the child model and the continuation
      // remains isolated from the parent conversation tools.
      delegationState.childContinuationCalls += 1;
      delegationState.childContinuationReceived = true;
      message = {
        role: "assistant",
        content: `${delegationChildContinuationMarker}：子 Agent 已保留上下文并完成续接，没有读取父对话历史。`,
      };
    } else if (delegationState && !delegateTool && delegationFailureMarker && !hasToolResult) {
      delegationState.activeChildModelRuns += 1;
      delegationState.childFailureReturned = true;
      delegationState.activeChildModelRuns -= 1;
      reply(response, 422, { error: { message: `${delegationFailureMarker}: delegated child model fixture failed as expected` } });
      return;
    } else if (delegationState && !delegateTool && delegationChildMarker && !hasToolResult) {
      if (!workspaceTool || processTool || processStartTool || workspaceWriteTool || workspacePatchTool) {
        reply(response, 422, { error: { message: "delegated child received tools outside its read-only allowlist" } });
        return;
      }
      delegationState.activeChildModelRuns += 1;
      message = {
        role: "assistant",
        content: "子 Agent 正在独立读取项目根目录。",
        tool_calls: [{
          id: "qa-agent-delegation-child-list",
          type: "function",
          function: { name: workspaceTool.function.name, arguments: "{\"path\":\"\",\"maxDepth\":0}" },
        }],
      };
    } else if (delegationState && !delegateTool && delegationChildMarker
      && lastAssistantToolCall?.id === "qa-agent-delegation-child-list") {
      delegationState.activeChildModelRuns = Math.max(0, delegationState.activeChildModelRuns - 1);
      message = {
        role: "assistant",
        content: `${delegationChildResultMarker || delegationChildMarker}：子 Agent 已通过独立模型调用和受限 workspace.list_files 完成根目录检查。`,
      };
    } else if (delegationState && delegateTool && !hasToolResult) {
      delegationState.childPermissionRequest = "full_access";
      message = {
        role: "assistant",
        content: "父 Agent 正在把根目录检查委派给一个受限的子 Agent。",
        tool_calls: [{
          id: "qa-agent-delegation-success",
          type: "function",
          function: {
            name: delegateTool.function.name,
            arguments: JSON.stringify({
              task: `${delegationMarker} ${delegationChildMarker} ${delegationChildResultMarker}：独立读取当前工作区根目录并返回简短结果。`,
              tools: ["workspace.list_files", "process.run"],
              permissionMode: "full_access",
              maxTurns: 4,
            }),
          },
        }],
      };
    } else if (delegationState && delegateTool
      && lastAssistantToolCall?.id === "qa-agent-delegation-success") {
      if (lastToolOutput?.status !== "completed" || lastToolOutput?.depth !== 1
        || !String(lastToolOutput?.finalText || "").includes(delegationChildResultMarker || "__missing__")
        || Number(lastToolOutput?.toolCalls || 0) < 1) {
        reply(response, 422, { error: { message: "parent did not receive the completed child-agent result" } });
        return;
      }
      delegationState.parentReceivedChildResult = true;
      const artifact = `artifacts/${delegationMarker}.txt`;
      message = {
        role: "assistant",
        content: "子 Agent 结果已回传，父 Agent 现在继续创建临时验收产物。",
        tool_calls: [{
          id: "qa-agent-delegation-parent-write",
          type: "function",
          function: {
            name: workspaceWriteTool.function.name,
            arguments: JSON.stringify({ path: artifact, content: `${delegationMarker}\nparent-resumed-after-child\n` }),
          },
        }],
      };
    } else if (delegationState && workspaceReadTool
      && lastAssistantToolCall?.id === "qa-agent-delegation-parent-write") {
      message = {
        role: "assistant",
        content: "父 Agent 已完成写入，正在复查子任务之后的临时产物。",
        tool_calls: [{
          id: "qa-agent-delegation-parent-read",
          type: "function",
          function: {
            name: workspaceReadTool.function.name,
            arguments: JSON.stringify({ path: `artifacts/${delegationMarker}.txt` }),
          },
        }],
      };
    } else if (delegationState && delegateTool
      && lastAssistantToolCall?.id === "qa-agent-delegation-parent-read") {
      if (!String(lastToolOutput?.content || "").includes("parent-resumed-after-child")) {
        reply(response, 422, { error: { message: "parent could not verify its post-delegation artifact" } });
        return;
      }
      delegationState.parentArtifactVerified = true;
      message = {
        role: "assistant",
        content: "父 Agent 已复查产物，现在验证子 Agent 失败事件可见且不阻断父任务。",
        tool_calls: [{
          id: "qa-agent-delegation-failure",
          type: "function",
          function: {
            name: delegateTool.function.name,
            arguments: JSON.stringify({
              task: `${delegationMarker} ${delegationFailureMarker}：执行可预期失败的子模型检查。`,
              tools: ["workspace.list_files"],
              permissionMode: "read_only",
              maxTurns: 2,
            }),
          },
        }],
      };
    } else if (delegationState && delegateTool
      && lastAssistantToolCall?.id === "qa-agent-delegation-failure") {
      if (lastToolPayload?.ok !== false || !delegationState.childFailureReturned) {
        reply(response, 422, { error: { message: "expected delegated child failure was not returned to the parent" } });
        return;
      }
      message = {
        role: "assistant",
        content: `${delegationMarker}：父 Agent 已收到 ${delegationChildResultMarker}，继续完成临时 artifacts 写入和复查；子 Agent 的工具与权限未提升，预期失败已由父 Agent 处理，任务结束时无残留子运行。`,
      };
    } else if (!hasToolResult && delegateTool
      && /NM_AGENT_DELEGATE_E2E|请调用子智能体|调用\s+agent\.delegate|invoke\s+(?:a\s+)?subagent/i.test(lastUserText)) {
      message = {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "qa-agent-delegate-1",
          type: "function",
          function: {
            name: delegateTool.function.name,
            arguments: JSON.stringify({
              task: "读取当前工作区根目录并返回简短结果。",
              tools: ["workspace.list_files"],
              permissionMode: "read_only",
              maxTurns: 3,
            }),
          },
        }],
      };
    } else if (delegateTool && lastAssistantToolCall?.function?.name === delegateTool.function.name) {
      message = {
        role: "assistant",
        content: "子智能体已完成独立模型调用与受限工作区工具任务。",
      };
    } else if (!hasToolResult && comicReadTool) {
      message = {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "qa-comic-read-1",
          type: "function",
          function: { name: comicReadTool.function.name, arguments: "{}" },
        }],
      };
    } else if (comicReadTool && comicAddShotTool && lastAssistantToolCall?.function?.name === comicReadTool.function.name) {
      const revision = lastToolOutput?.revision;
      const sceneId = lastToolOutput?.scenes?.[0]?.id;
      if (!Number.isSafeInteger(revision) || typeof sceneId !== "string") {
        reply(response, 422, { error: { message: "comic.get_project QA result was missing revision or scene" } });
        return;
      }
      message = {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "qa-comic-add-shot-1",
          type: "function",
          function: {
            name: comicAddShotTool.function.name,
            arguments: JSON.stringify({
              expectedRevision: revision,
              sceneId,
              title: "QA 类型化镜头",
              durationSeconds: 2,
              shotSize: "medium",
              visualPrompt: "雨夜码头，角色回头，冷色侧光",
              dialogue: "这次修改来自漫剧类型化工具。",
            }),
          },
        }],
      };
    } else if (comicReadTool && lastAssistantToolCall?.function?.name === comicAddShotTool?.function?.name) {
      message = {
        role: "assistant",
        content: "漫剧 Agent 类型化工具调用已验证；工程 JSON 未向模型开放通用写入。",
      };
    } else if (!hasToolResult && processStartTool && processReadTool && processWriteTool && processTerminateTool
      && /NM_MANAGED_PTY_E2E_\d+/i.test(lastUserText)) {
      message = {
        role: "assistant",
        content: "正在启动所选终端，并验证实时输出能被界面和模型同时读取。",
        tool_calls: [{
          id: "qa-managed-pty-start",
          type: "function",
          function: {
            name: processStartTool.function.name,
            arguments: JSON.stringify({ useTerminalProfile: true, tty: true, columns: 100, rows: 28, timeoutMs: 30_000 }),
          },
        }],
      };
    } else if (lastAssistantToolCall?.id === "qa-managed-pty-start" && processWriteTool) {
      const processId = lastToolOutput?.processId;
      const marker = lastUserText.match(/NM_MANAGED_PTY_E2E_\d+/i)?.[0];
      if (typeof processId !== "string" || !marker) {
        reply(response, 422, { error: { message: "managed PTY start did not return a process id" } });
        return;
      }
      message = {
        role: "assistant",
        content: "终端已经在线，正在写入可移植命令并等待流式输出。",
        tool_calls: [{
          id: "qa-managed-pty-write",
          type: "function",
          function: {
            name: processWriteTool.function.name,
            arguments: JSON.stringify({ processId, data: `echo ${marker}\r\n` }),
          },
        }],
      };
    } else if (lastAssistantToolCall?.id === "qa-managed-pty-write" && processReadTool) {
      const processId = lastToolOutput?.processId;
      if (typeof processId !== "string") {
        reply(response, 422, { error: { message: "managed PTY write did not preserve the process id" } });
        return;
      }
      message = {
        role: "assistant",
        content: "命令已经发送，正在按序列游标读取最新终端输出。",
        tool_calls: [{
          id: "qa-managed-pty-read-1",
          type: "function",
          function: {
            name: processReadTool.function.name,
            arguments: JSON.stringify({ processId, afterSequence: 0, waitMs: 3_000, maxCharacters: 16_384 }),
          },
        }],
      };
    } else if (/^qa-managed-pty-read-\d+$/.test(lastAssistantToolCall?.id || "") && processReadTool && processTerminateTool) {
      const marker = lastUserText.match(/NM_MANAGED_PTY_E2E_\d+/i)?.[0];
      const processId = lastToolOutput?.processId;
      // A real model sees every preceding process.read result in the turn, not
      // only the final incremental chunk. Aggregate the complete tool context
      // so output split across PTY frames is observed deterministically.
      const output = toolOutputs.flatMap(result => Array.isArray(result?.chunks) ? result.chunks : [])
        .map(chunk => typeof chunk?.text === "string" ? chunk.text : "").join("");
      const attempt = Number(lastAssistantToolCall.id.split("-").at(-1) || 1);
      if (marker && output.includes(marker) && typeof processId === "string"
        && Number(lastToolOutput?.nextSequence || 0) > 0) {
        message = {
          role: "assistant",
          content: "模型已从实时游标中读到终端输出，正在关闭测试终端并清理进程树。",
          tool_calls: [{
            id: "qa-managed-pty-terminate",
            type: "function",
            function: { name: processTerminateTool.function.name, arguments: JSON.stringify({ processId }) },
          }],
        };
      } else if (typeof processId === "string" && attempt < 6) {
        message = {
          role: "assistant",
          content: "终端仍在运行，继续从上一个序列位置读取新增输出。",
          tool_calls: [{
            id: `qa-managed-pty-read-${attempt + 1}`,
            type: "function",
            function: {
              name: processReadTool.function.name,
              arguments: JSON.stringify({
                processId,
                afterSequence: Number(lastToolOutput?.nextSequence || 0),
                waitMs: 3_000,
                maxCharacters: 16_384,
              }),
            },
          }],
        };
      } else {
        reply(response, 422, { error: { message: "the model could not observe the managed PTY marker" } });
        return;
      }
    } else if (lastAssistantToolCall?.id === "qa-managed-pty-terminate") {
      const marker = lastUserText.match(/NM_MANAGED_PTY_E2E_\d+/i)?.[0] || "NM_MANAGED_PTY_E2E";
      if (lastToolOutput?.running !== false) {
        reply(response, 422, { error: { message: "managed PTY termination did not confirm process exit" } });
        return;
      }
      message = { role: "assistant", content: `${marker}：真实终端已完成输入、实时输出、模型游标读取与进程清理。` };
    } else if (!hasToolResult && processTool
      && (/生命周期真实回归|运行中调整方向真实回归|消息队列真实回归|真实滚动生命周期回归/i.test(lastUserText)
        || (/调用\s+process\.run/i.test(lastUserText) && !/不要调用\s+process\.run/i.test(lastUserText)))) {
      const marker = lastUserText.match(/NM_[A-Z0-9_]+_\d+/)?.[0] || "NM_PROCESS_QA";
      const requestedDelay = Number(lastUserText.match(/setTimeout\(\(\)=>console\.log\('[^']+'\),(\d+)\)/)?.[1] || 30);
      const automaticResumeFixture = /^NM_AUTO_RESUME_E2E_\d+$/.test(marker);
      const rateLimitFixture = /^NM_RATE_LIMIT_E2E_\d+$/.test(marker);
      const failedCommandFixture = /^NM_COMMAND_FAILURE_E2E_\d+$/.test(marker);
      const countPath = `artifacts/${marker}.count`;
      const source = automaticResumeFixture || rateLimitFixture
        ? `const fs=require('node:fs');fs.mkdirSync('artifacts',{recursive:true});fs.appendFileSync(${JSON.stringify(countPath)},'1\\n');setTimeout(()=>console.log('${marker}'),${Math.max(100, Math.min(30_000, requestedDelay))})`
        : failedCommandFixture
          ? `setTimeout(()=>{process.stderr.write('${marker} expected non-zero exit\\n');process.exit(7)},1200)`
          : `setTimeout(()=>console.log('${marker}'),${Math.max(0, Math.min(30_000, requestedDelay))})`;
      if (rateLimitFixture && rateLimitState) rateLimitState.processRequests += 1;
      if (automaticResumeFixture && recoveryState) recoveryState.processRequests += 1;
      message = {
        role: "assistant",
        content: "正在运行生命周期回归命令。",
        tool_calls: [{
          id: rateLimitFixture ? "qa-rate-limit-process-1" : "qa-process-run-1",
          type: "function",
          function: {
            name: processTool.function.name,
            arguments: JSON.stringify({
              command: "node",
              args: ["-e", source],
            }),
          },
        }],
      };
    } else if (processTool && lastAssistantToolCall?.function?.name === processTool.function.name) {
      const automaticResumeMarker = lastUserText.match(/NM_AUTO_RESUME_E2E_\d+/)?.[0];
      const rateLimitMarker = lastUserText.match(/NM_RATE_LIMIT_E2E_\d+/)?.[0];
      const failedCommandMarker = lastUserText.match(/NM_COMMAND_FAILURE_E2E_\d+/)?.[0];
      if (automaticResumeMarker && !transientFailureMarkers.has(automaticResumeMarker)) {
        transientFailureMarkers.add(automaticResumeMarker);
        recoveryState.unavailableResponses += 1;
        reply(response, 503, { error: { message: "transient QA model interruption after completed tool" } });
        return;
      }
      if (automaticResumeMarker && workspaceReadTool) {
        recoveryState.readRequests += 1;
        message = {
          role: "assistant",
          content: "用户确认后继续，正在确认先前完成的命令没有被重复执行。",
          tool_calls: [{
            id: "qa-auto-resume-read-1",
            type: "function",
            function: {
              name: workspaceReadTool.function.name,
              arguments: JSON.stringify({ path: `artifacts/${automaticResumeMarker}.count` }),
            },
          }],
        };
      } else if (rateLimitMarker && rateLimitState?.rateLimitResponses === 1
        && rateLimitState.readRequests === 0 && workspaceReadTool) {
        rateLimitState.readRequests += 1;
        message = {
          role: "assistant",
          content: "限流已记录，正在确认检查点没有重复执行已完成的命令。",
          tool_calls: [{
            id: "qa-rate-limit-read-1",
            type: "function",
            function: {
              name: workspaceReadTool.function.name,
              arguments: JSON.stringify({ path: `artifacts/${rateLimitMarker}.count` }),
            },
          }],
        };
      } else if (failedCommandMarker) {
        message = { role: "assistant", content: `${failedCommandMarker}：非零退出码已被记录，失败详情可展开查看。` };
      } else {
        message = { role: "assistant", content: "生命周期命令与工具事件已经完成。" };
      }
    } else if (lastAssistantToolCall?.id === "qa-rate-limit-read-1") {
      const rateLimitMarker = lastUserText.match(/NM_RATE_LIMIT_E2E_\d+/)?.[0];
      const count = typeof lastToolOutput?.content === "string"
        ? lastToolOutput.content.split(/\r?\n/).filter(Boolean).length
        : 0;
      if (!rateLimitMarker || count !== 1) {
        reply(response, 422, { error: { message: `rate-limit recovery repeated a completed command (${count} executions)` } });
        return;
      }
      message = {
        role: "assistant",
        content: `${rateLimitMarker}：429 已按可恢复状态处理；已完成的命令只执行 1 次，检查点上下文已保留。`,
      };
    } else if (lastAssistantToolCall?.id === "qa-auto-resume-read-1") {
      const automaticResumeMarker = lastUserText.match(/NM_AUTO_RESUME_E2E_\d+/)?.[0];
      const count = typeof lastToolOutput?.content === "string"
        ? lastToolOutput.content.split(/\r?\n/).filter(Boolean).length
        : 0;
      if (!automaticResumeMarker || count !== 1) {
        reply(response, 422, { error: { message: `automatic resume repeated a completed command (${count} executions)` } });
        return;
      }
      message = {
        role: "assistant",
        content: `${automaticResumeMarker}：用户确认后继续；已完成的命令只执行 1 次，检查点上下文和最终总结均已保留。`,
      };
    } else if (!hasToolResult && taskPlanTool && workspaceTool && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      message = {
        role: "assistant",
        content: contractCopy.start,
        tool_calls: [{
          id: "qa-task-plan-start-1",
          type: "function",
          function: {
            name: taskPlanTool.function.name,
            arguments: JSON.stringify({
              steps: [
                { id: "baseline", title: contractCopy.steps[0], status: "in_progress" },
                { id: "create", title: contractCopy.steps[1], status: "pending" },
                { id: "read", title: contractCopy.steps[2], status: "pending" },
                { id: "edit", title: contractCopy.steps[3], status: "pending" },
                { id: "verify", title: contractCopy.steps[4], status: "pending" },
                { id: "summary", title: contractCopy.steps[5], status: "pending" },
              ],
            }),
          },
        }],
      };
    } else if (workspaceTool && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)
      && ((!taskPlanTool && !hasToolResult) || lastAssistantToolCall?.id === "qa-task-plan-start-1")) {
      message = {
        role: "assistant",
        content: contractCopy.inspect,
        tool_calls: [{
          id: "qa-workspace-list-1",
          type: "function",
          function: { name: workspaceTool.function.name, arguments: "{\"path\":\"\",\"maxDepth\":0}" },
        }],
      };
    } else if (taskPlanTool && lastAssistantToolCall?.id === "qa-workspace-list-1"
      && lastAssistantToolCall?.function?.name === workspaceTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      message = {
        role: "assistant",
        content: contractCopy.baseline,
        tool_calls: [{
          id: "qa-task-plan-create-1",
          type: "function",
          function: {
            name: taskPlanTool.function.name,
            arguments: JSON.stringify({
              steps: [
                { id: "baseline", title: contractCopy.steps[0], status: "completed" },
                { id: "create", title: contractCopy.steps[1], status: "in_progress" },
                { id: "read", title: contractCopy.steps[2], status: "pending" },
                { id: "edit", title: contractCopy.steps[3], status: "pending" },
                { id: "verify", title: contractCopy.steps[4], status: "pending" },
                { id: "summary", title: contractCopy.steps[5], status: "pending" },
              ],
            }),
          },
        }],
      };
    } else if (workspaceWriteTool
      && ((taskPlanTool && lastAssistantToolCall?.id === "qa-task-plan-create-1"
        && lastAssistantToolCall?.function?.name === taskPlanTool.function.name)
        || (!taskPlanTool && lastAssistantToolCall?.id === "qa-workspace-list-1"
          && lastAssistantToolCall?.function?.name === workspaceTool?.function?.name))
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      const fixture = toolContractFixturePath(lastUserText);
      if (!fixture) {
        reply(response, 422, { error: { message: "tool-contract fixture path was missing" } });
        return;
      }
      message = {
        role: "assistant",
        content: contractCopy.create,
        tool_calls: [{
          id: "qa-workspace-write-1",
          type: "function",
          function: {
            name: workspaceWriteTool.function.name,
            arguments: JSON.stringify({ path: fixture, content: "alpha\nbeta\n" }),
          },
        }],
      };
    } else if (workspaceReadTool && lastAssistantToolCall?.id === "qa-workspace-write-1"
      && lastAssistantToolCall?.function?.name === workspaceWriteTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      const fixture = toolContractFixturePath(lastUserText);
      if (!fixture) {
        reply(response, 422, { error: { message: "tool-contract fixture path was missing" } });
        return;
      }
      message = {
        role: "assistant",
        content: contractCopy.read,
        tool_calls: [{
          id: "qa-workspace-read-1",
          type: "function",
          function: { name: workspaceReadTool.function.name, arguments: JSON.stringify({ path: fixture }) },
        }],
      };
    } else if (workspacePatchTool && lastAssistantToolCall?.id === "qa-workspace-read-1"
      && lastAssistantToolCall?.function?.name === workspaceReadTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      const fixture = toolContractFixturePath(lastUserText);
      const expectedSha256 = lastToolOutput?.sha256;
      if (!fixture || typeof expectedSha256 !== "string") {
        reply(response, 422, { error: { message: "tool-contract read result was missing path or SHA-256" } });
        return;
      }
      message = {
        role: "assistant",
        content: contractCopy.patch,
        tool_calls: [{
          id: "qa-workspace-patch-1",
          type: "function",
          function: {
            name: workspacePatchTool.function.name,
            arguments: JSON.stringify({
              path: fixture,
              expectedSha256,
              patch: [
                `--- a/${fixture}`,
                `+++ b/${fixture}`,
                "@@ -1,2 +1,2 @@",
                " alpha",
                "-beta",
                "+gamma",
                "",
              ].join("\n"),
            }),
          },
        }],
      };
    } else if (workspaceReadTool && lastAssistantToolCall?.id === "qa-workspace-patch-1"
      && lastAssistantToolCall?.function?.name === workspacePatchTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      const fixture = toolContractFixturePath(lastUserText);
      if (!fixture) {
        reply(response, 422, { error: { message: "tool-contract fixture path was missing" } });
        return;
      }
      message = {
        role: "assistant",
        content: contractCopy.verify,
        tool_calls: [{
          id: "qa-workspace-read-2",
          type: "function",
          function: { name: workspaceReadTool.function.name, arguments: JSON.stringify({ path: fixture }) },
        }],
      };
    } else if (workspaceTool && lastAssistantToolCall?.id === "qa-workspace-read-2"
      && lastAssistantToolCall?.function?.name === workspaceReadTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      message = {
        role: "assistant",
        content: contractCopy.inventory,
        tool_calls: [{
          id: "qa-workspace-list-2",
          type: "function",
          function: {
            name: workspaceTool.function.name,
            arguments: JSON.stringify({ path: marketingEnglish ? "src" : "artifacts", maxDepth: 0 }),
          },
        }],
      };
    } else if (lastAssistantToolCall?.id === "qa-workspace-list-2"
      && lastAssistantToolCall?.function?.name === workspaceTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      message = taskPlanTool ? {
        role: "assistant",
        content: contractCopy.finishPlan,
        tool_calls: [{
          id: "qa-task-plan-complete-1",
          type: "function",
          function: {
            name: taskPlanTool.function.name,
            arguments: JSON.stringify({
              steps: [
                { id: "baseline", title: contractCopy.steps[0], status: "completed" },
                { id: "create", title: contractCopy.steps[1], status: "completed" },
                { id: "read", title: contractCopy.steps[2], status: "completed" },
                { id: "edit", title: contractCopy.steps[3], status: "completed" },
                { id: "verify", title: contractCopy.steps[4], status: "completed" },
                { id: "summary", title: contractCopy.steps[5], status: "completed" },
              ],
            }),
          },
        }],
      } : { role: "assistant", content: contractCopy.complete };
    } else if (lastAssistantToolCall?.id === "qa-task-plan-complete-1"
      && lastAssistantToolCall?.function?.name === taskPlanTool?.function?.name
      && /NM_TOOL_CONTRACT_E2E_/i.test(lastUserText)) {
      message = { role: "assistant", content: contractCopy.complete };
    } else if (!hasToolResult && workspaceTool) {
      message = {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "qa-workspace-list-1",
          type: "function",
          function: { name: workspaceTool.function.name, arguments: "{\"path\":\".\",\"maxDepth\":1,\"limit\":20}" },
        }],
      };
    } else {
      message = {
        role: "assistant",
        content: "官方 BYOK 本机直连与工作区工具调用已验证。",
      };
    }
    const responseModel = typeof body.model === "string" ? body.model : qaModel;
    if (body.stream === true) {
      replyOpenAIStream(response, responseModel, message);
      return;
    }
    reply(response, 200, {
      id: "nextmux-official-qa",
      object: "chat.completion",
      model: responseModel,
      choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
      usage: { prompt_tokens: 21, completion_tokens: 6, total_tokens: 27 },
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`NextMux official-model QA server listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
