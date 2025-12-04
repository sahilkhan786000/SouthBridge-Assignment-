// src/agent-tool.ts
import { v4 as uuidv4 } from "uuid";
import { Ollama } from "./llm";
import { FileManager } from "./fileManager";
import { Shell } from "./shell";
import { ToolManager } from "./toolManager";
import * as fs from "fs/promises";
import * as path from "path";

function send(obj: any) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export class Agent {
  sessions: Record<string, any> = {};
  llm = new Ollama();
  file = new FileManager();
  shell = new Shell();
  tools = new ToolManager(this.file, this.shell);

  get sessionsDir() {
    // Put tool sessions in workspace/.acp_tools_sessions
    const base = (this.file && (this.file.base as string)) || ".";
    return path.join(base, ".acp_tools_sessions");
  }

  async ensureSessionsDir() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  async saveSessionToDisk(sessionId: string) {
    const s = this.sessions[sessionId];
    if (!s) throw new Error("unknown_session");
    await this.ensureSessionsDir();
    const out = {
      id: s.id,
      model: s.model,
      workspace: s.workspace,
      toolRequests: s.toolRequests ?? {},
      savedAt: new Date().toISOString()
    };
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    await fs.writeFile(filePath, JSON.stringify(out, null, 2), "utf-8");
    return { ok: true, path: filePath };
  }

  async loadSessionFromDisk(sessionId: string) {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return parsed;
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
        const id = f.replace(/\.json$/, "");
        const parsed = await this.loadSessionFromDisk(id);
        if (parsed) {
          this.sessions[id] = {
            id,
            model: parsed.model ?? "phi3",
            workspace: parsed.workspace ?? (this.file && this.file.base),
            toolRequests: parsed.toolRequests ?? {}
          };
        }
      }
      return { loaded: Object.keys(this.sessions).length };
    } catch (err) {
      return { loaded: 0 };
    }
  }

  /* ---------------- INITIALIZE ---------------- */
  async initialize() {
    try {
      await this.initializeSessionsFromDisk();
    } catch (e) {}
    send({ type: "initialized", payload: {} });
    return {
      protocolVersion: 1,
      agentInfo: { name: "acp-tool-agent", version: "1.1" },
      features: {
        streaming: true,
        fileOps: true,
        shell: true,
        toolApprovalFlow: true
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
      toolRequests: {}
    };

    try {
      await this.saveSessionToDisk(sessionId);
    } catch (e) {
      // ignore
    }

    send({ type: "session_created", payload: { sessionId, model, workspace } });
    return { sessionId, model, workspace };
  }

  /* ---------------- SET MODEL / WORKSPACE ---------------- */
  async setModel(payload: { sessionId: string; model: string }) {
    const s = this.sessions[payload.sessionId];
    if (!s) return { error: "unknown_session" };
    s.model = payload.model;
    await this.saveSessionToDisk(payload.sessionId).catch(() => {});
    return { ok: true };
  }

  async setWorkspace(payload: { sessionId: string; workspace: string }) {
    const s = this.sessions[payload.sessionId];
    if (!s) return { error: "unknown_session" };
    await this.file.ensureWorkspace(payload.workspace);
    s.workspace = payload.workspace;
    await this.saveSessionToDisk(payload.sessionId).catch(() => {});
    return { ok: true };
  }

  /* ---------------- SYSTEM PROMPT ---------------- */
  SYSTEM_PROMPT = `
You are an ACP-compliant agent.
You MUST follow these rules EXACTLY and WITHOUT EXCEPTION.

You must output ONLY ONE TOOL_CALL. Never repeat a TOOL_CALL.
If you output a TOOL_CALL, produce no additional instructions, rules, or new constraints afterwards.

========================
RULE 1 — WHEN TO USE A TOOL
========================
Use a TOOL_CALL ONLY when the user explicitly requests an action such as:
- "run", "execute", "shell", "ls", "mkdir", "compile", "install", etc.
- "create file", "write file", "edit file", "read file"

========================
RULE 2 — TOOL_CALL FORMAT
========================
If a tool is required, output EXACTLY:

TOOL_CALL: {"name":"<tool>","args":{...}}

STRICT RULES:
- No text before or after the TOOL_CALL (except the single TOOL_CALL itself).
- No explanations.
- No code blocks.
- No multiple tool calls.

========================
AVAILABLE TOOLS
========================
create_file: { "path": "string", "content": "string" }
read_file:   { "path": "string" }
edit_file:   { "path": "string", "content": "string" }
run_shell:   { "command": "string" }
`;

  /* ---------------- HELPER: brace matching extraction (first block only) ---------------- */
  extractToolBlockFromText(text: string): { start: number; end: number; blockText: string } | null {
    const marker = "TOOL_CALL:";
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    const braceStart = text.indexOf("{", idx + marker.length);
    if (braceStart === -1) return null;

    let depth = 0;
    let i = braceStart;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const block = text.slice(braceStart, i + 1);
          return { start: idx, end: i + 1, blockText: block };
        }
      }
    }
    return null;
  }

 
 normalizePath(base: string, p: string) {
  if (!p) return p;

  
  if (path.isAbsolute(p)) return p;

  const root = base;

  
  if (p.includes("/") || p.includes("\\")) {
    return path.join(root, ".files", p);
  }

  return path.join(root, ".files", p);
}



  async handlePrompt(payload: { sessionId?: string; text: string; stream?: boolean }) {
    const sessionId = payload.sessionId ?? Object.keys(this.sessions)[0];
    const session = this.sessions[sessionId];
    if (!session) {
      send({ type: "error", message: "unknown_session" });
      return { text: "" };
    }
    const model = session?.model ?? "phi3";
    const userText = payload.text;
    const fullPrompt = `${this.SYSTEM_PROMPT}\nUser: ${userText}`;

    const ALLOWED_TOOLS = new Set(["create_file", "read_file", "edit_file", "run_shell"]);

    // streaming path
    if (payload.stream) {
      let collectedFull = "";
      try {
        await this.llm.chatStream(model, fullPrompt, (chunk: string) => {
          collectedFull += chunk;
          send({ type: "stream_chunk", payload: { sessionId, chunk } });
        });

        // parse only first TOOL_CALL (if any)
        const match = this.extractToolBlockFromText(collectedFull);
        if (!match) {
          send({ type: "response", payload: { text: collectedFull } });
          return { text: collectedFull };
        }

        // parse the first tool block
        let parsedTool: any;
        try {
          parsedTool = JSON.parse(match.blockText);
        } catch (err) {
          send({ type: "tool_parse_error", payload: { sessionId, reason: "invalid_tool_json_stream", raw: match.blockText } });
          const sanitized = collectedFull.replace(/\n/g, " ").slice(0, 400).replace(/TOOL_CALL:.*/g, "");
          send({ type: "response", payload: { text: sanitized } });
          return { text: sanitized };
        }

        if (!parsedTool?.name || !ALLOWED_TOOLS.has(parsedTool.name)) {
          send({
            type: "tool_invalid",
            payload: { sessionId, tool: parsedTool, reason: `unsupported_tool: ${parsedTool?.name}` }
          });
          send({ type: "response", payload: { text: `Model attempted to call unsupported tool "${parsedTool?.name}".` } });
          return { text: `Model attempted to call unsupported tool "${parsedTool?.name}".` };
        }

        // Ensure args object exists
        parsedTool.args = parsedTool.args ?? {};

        // Normalize paths for file ops
        if (["create_file", "read_file", "edit_file"].includes(parsedTool.name)) {
          if (parsedTool.args.path) {
            parsedTool.args.path = this.normalizePath(session.workspace, parsedTool.args.path);
          }
        }

        // Create parent dir for file operations to avoid errors
        if (parsedTool.args?.path) {
          const parent = path.dirname(parsedTool.args.path);
          try {
            await fs.mkdir(parent, { recursive: true });
          } catch (e) {
            // ignore
          }
        }

        // assistant_excerpt: clean text before the tool call
        const assistant_excerpt = collectedFull.slice(0, match.start).replace(/\s+/g, " ").trim().slice(-400) + " " + match.blockText;

        // Register pending tool request and persist
        const toolId = uuidv4();
        session.toolRequests = session.toolRequests ?? {};
        session.toolRequests[toolId] = {
          id: toolId,
          tool: parsedTool,
          status: "pending",
          requestedAt: Date.now()
        };

        await this.saveSessionToDisk(sessionId).catch(() => {});

        send({
          type: "tool_permission_request",
          payload: {
            sessionId,
            toolId,
            tool: parsedTool,
            assistant_excerpt
          }
        });

        send({ type: "response", payload: { text: "Awaiting tool approval…" } });
        return { text: "Awaiting tool approval…" };

      } catch (err) {
        send({ type: "error", message: (err as any).message });
        return { text: "" };
      }
    }

    // non-stream path
    try {
      const assistantText = await this.llm.chat(model, fullPrompt);

      // parse only first TOOL_CALL (if any)
      const match = this.extractToolBlockFromText(assistantText);
      if (!match) {
        send({ type: "response", payload: { text: assistantText } });
        return { text: assistantText };
      }

      // parse the first tool block
      let parsedTool: any;
      try {
        parsedTool = JSON.parse(match.blockText);
      } catch (err) {
        send({ type: "tool_parse_error", payload: { sessionId, reason: "invalid_tool_json", raw: match.blockText } });
        const sanitized = assistantText.replace(/\n/g, " ").slice(0, 400).replace(/TOOL_CALL:.*/g, "");
        send({ type: "response", payload: { text: sanitized } });
        return { text: sanitized };
      }

      const ALLOWED_TOOLS_LOCAL = new Set(["create_file", "read_file", "edit_file", "run_shell"]);
      if (!parsedTool?.name || !ALLOWED_TOOLS_LOCAL.has(parsedTool.name)) {
        send({ type: "tool_invalid", payload: { sessionId, tool: parsedTool, reason: `unsupported_tool: ${parsedTool?.name}` } });
        send({ type: "response", payload: { text: `Model attempted to call unsupported tool "${parsedTool?.name}".` } });
        return { text: `Model attempted to call unsupported tool "${parsedTool?.name}".` };
      }

      parsedTool.args = parsedTool.args ?? {};

      // Normalize paths for file ops
      if (["create_file", "read_file", "edit_file"].includes(parsedTool.name)) {
        if (parsedTool.args.path) {
          parsedTool.args.path = this.normalizePath(session.workspace, parsedTool.args.path);
        }
      }

      // Create parent dir for file operations to avoid errors
      if (parsedTool.args?.path) {
        const parent = path.dirname(parsedTool.args.path);
        try {
          await fs.mkdir(parent, { recursive: true });
        } catch (e) {
          // ignore
        }
      }

      // assistant_excerpt: clean text before the tool call
      const assistant_excerpt = assistantText.slice(0, match.start).replace(/\s+/g, " ").trim().slice(-400) + " " + match.blockText;

      // Register pending tool
      const toolId = uuidv4();
      session.toolRequests = session.toolRequests ?? {};
      session.toolRequests[toolId] = {
        id: toolId,
        tool: parsedTool,
        status: "pending",
        requestedAt: Date.now()
      };

      await this.saveSessionToDisk(sessionId).catch(() => {});

      send({
        type: "tool_permission_request",
        payload: {
          sessionId,
          toolId,
          tool: parsedTool,
          assistant_excerpt
        }
      });

      send({ type: "response", payload: { text: "Awaiting tool approval…" } });
      return { text: "Awaiting tool approval…" };
    } catch (err) {
      send({ type: "error", message: (err as any).message });
      return { text: "" };
    }
  }

  /* ---------------- TOOL APPROVAL ---------------- */
  async handleToolPermissionResponse(payload: { sessionId: string; toolId: string; approve: boolean }) {
    const s = this.sessions[payload.sessionId];
    if (!s) return { error: "unknown_session" };

    const req = s.toolRequests[payload.toolId];
    if (!req) return { error: "unknown_toolId" };

    if (!payload.approve) {
      req.status = "rejected";
      req.resolvedAt = Date.now();
      await this.saveSessionToDisk(payload.sessionId).catch(() => {});
      send({ type: "tool_rejected", payload: { sessionId: payload.sessionId, toolId: payload.toolId } });
      return { ok: true, rejected: true };
    }

    // Before execution: ensure parent directory exists for file ops (safety)
    try {
      const tool = req.tool;
      if (tool?.args?.path && (tool.name === "create_file" || tool.name === "edit_file")) {
        const parent = path.dirname(tool.args.path);
        await fs.mkdir(parent, { recursive: true }).catch(() => {});
      }
    } catch (e) {
      // ignore
    }

    // Execute tool
    const result = await this.tools.handleToolCall(req.tool);
    req.status = "approved";
    req.resolvedAt = Date.now();
    await this.saveSessionToDisk(payload.sessionId).catch(() => {});
    send({ type: "tool_result", payload: { sessionId: payload.sessionId, toolId: payload.toolId, result } });
    return { ok: true, result };
  }
}

/* ---------- wire to stdin messages (simple dispatcher) ---------- */
const agent = new Agent();

(async () => {
  // Read lines from stdin and dispatch to methods
  const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  rl.on("line", async (line: string) => {
    if (!line) return;
    try {
      const msg = JSON.parse(line);
      const type = msg.type;
      const payload = msg.payload;
      if (type === "initialize") {
        await agent.initialize();
      } else if (type === "new_session") {
        await agent.newSession(payload || {});
      } else if (type === "prompt") {
        await agent.handlePrompt(payload || {});
      } else if (type === "approve_tool" || type === "approve_tool_response" || type === "tool_permission_response") {
        await agent.handleToolPermissionResponse(payload || {});
      } else if (type === "set_model") {
        await agent.setModel(payload || {});
      } else if (type === "set_workspace") {
        await agent.setWorkspace(payload || {});
      } else {
        // unknown message
        send({ type: "error", message: `unknown_message_type: ${type}` });
      }
    } catch (err) {
      send({ type: "error", message: `invalid_json_or_processing_error: ${(err as any).message}` });
    }
  });
})();
