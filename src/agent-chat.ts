// src/agent-chat.ts
import { v4 as uuidv4 } from "uuid";
import { Ollama } from "./llm";
import { FileManager } from "./fileManager";
import * as fs from "fs/promises";
import * as path from "path";

function send(obj: any) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export class Agent {
  sessions: Record<string, any> = {};
  llm = new Ollama();
  file = new FileManager();

  /* ---------------- CHAT SESSINS DIR ---------------- */
  get sessionsDir() {
    
    const base = (this.file && (this.file.base as string)) || ".";
    return path.join(base, ".acp_chat_sessions");
  }

  async ensureSessionsDir() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch {}
  }

  async saveSessionToDisk(sessionId: string) {
    const s = this.sessions[sessionId];
    if (!s) return;

    await this.ensureSessionsDir();
    const fp = path.join(this.sessionsDir, `${sessionId}.json`);

    const writeObj = {
      id: s.id,
      model: s.model,
      workspace: s.workspace,
      history: s.history ?? [],
      savedAt: new Date().toISOString()
    };

    await fs.writeFile(fp, JSON.stringify(writeObj, null, 2), "utf-8");
  }

  async loadSessionFromDisk(sessionId: string) {
    const fp = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      const raw = await fs.readFile(fp, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async initializeSessionsFromDisk() {
    await this.ensureSessionsDir();
    try {
      const files = await fs.readdir(this.sessionsDir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const id = f.replace(".json", "");
        const parsed = await this.loadSessionFromDisk(id);
        if (parsed) {
          this.sessions[id] = {
            id,
            model: parsed.model ?? "phi3",
            workspace: parsed.workspace ?? this.file.base,
            history: parsed.history ?? []
          };
        }
      }
      return { loaded: Object.keys(this.sessions).length };
    } catch {
      return { loaded: 0 };
    }
  }

  /* ---------------- INITIALIZE ---------------- */
  async initialize() {
    await this.initializeSessionsFromDisk();

    send({ type: "initialized", payload: {} });

    return {
      protocolVersion: 1,
      agentInfo: { name: "chat-only-agent", version: "1.0" },
      features: {
        streaming: true,
        toolApprovalFlow: false,
        shell: false,
        fileOps: false
      }
    };
  }

  /* ---------------- NEW SESSION ---------------- */
  async newSession(payload: { model?: string; workspace?: string }) {
    const sessionId = uuidv4();
    const model = payload.model ?? "phi3";
    const workspace = payload.workspace ?? this.file.base;

    await this.file.ensureWorkspace(workspace);

    this.sessions[sessionId] = {
      id: sessionId,
      model,
      workspace,
      history: []
    };

    await this.saveSessionToDisk(sessionId);

    send({
      type: "session_created",
      payload: { sessionId, model, workspace }
    });

    return { sessionId, model, workspace };
  }

  async setModel(payload: { sessionId: string; model: string }) {
    const s = this.sessions[payload.sessionId];
    if (!s) return { error: "unknown_session" };
    s.model = payload.model;
    await this.saveSessionToDisk(payload.sessionId);
    return { ok: true };
  }

  async setWorkspace(payload: { sessionId: string; workspace: string }) {
    const s = this.sessions[payload.sessionId];
    if (!s) return { error: "unknown_session" };
    await this.file.ensureWorkspace(payload.workspace);
    s.workspace = payload.workspace;
    await this.saveSessionToDisk(payload.sessionId);
    return { ok: true };
  }

  /* ---------------- MAIN CHAT LOGIC ---------------- */
  async handlePrompt(payload: { sessionId?: string; text: string; stream?: boolean }) {
    const sessionId = payload.sessionId ?? Object.keys(this.sessions)[0];
    const session = this.sessions[sessionId];
    if (!session) return { error: "unknown_session" };

    const model = session.model;
    const userMessage = payload.text;

    session.history.push({ role: "user", text: userMessage });

    let finalText = "";

    /* STREAMING MODE ----------------------- */
    if (payload.stream) {
      let collected = "";

      await this.llm.chatStream(model, userMessage, (chunk: string) => {
        collected += chunk;
        send({ type: "stream_chunk", payload: { sessionId, chunk } });
      });

      finalText = collected;
    }
    /* NON-STREAM --------------------------- */
    else {
      finalText = await this.llm.chat(model, userMessage);
    }

    
    session.history.push({ role: "assistant", text: finalText });

    await this.saveSessionToDisk(sessionId);

    send({
      type: "response",
      payload: { sessionId, text: finalText }
    });

    return { text: finalText };
  }
}


const agent = new Agent();
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

readline.on("line", async (line: string) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const { type, payload } = msg;

    if (type === "initialize") {
      await agent.initialize();
    } else if (type === "new_session") {
      await agent.newSession(payload);
    } else if (type === "prompt") {
      await agent.handlePrompt(payload);
    } else if (type === "set_model") {
      await agent.setModel(payload);
    } else if (type === "set_workspace") {
      await agent.setWorkspace(payload);
    } else {
      send({ type: "error", message: `unknown_message_type: ${type}` });
    }
  } catch (err) {
    send({ type: "error", message: (err as any).message });
  }
});
