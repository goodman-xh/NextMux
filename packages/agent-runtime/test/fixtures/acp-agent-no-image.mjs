#!/usr/bin/env node

import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

const app = acp
  .agent({ name: "nextmux-acp-no-image-test-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { promptCapabilities: { image: false } },
  }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: crypto.randomUUID() }))
  .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: "end_turn" }));

const connection = app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
await connection.closed;

