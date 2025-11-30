// // src/acp.ts
// import * as fs from "fs";
// import path from "path";
// const { spawn } = Bun; // use Bun spawn
// import { isNotification, isRequest, isResponse } from "./utils";
// import { FileManager } from "./fileManager";
// import { TerminalManager } from "./terminalManager";
// import { handleSessionUpdate } from "./toolHandler";

// export type State = {
//   nextId: number;
//   pending: Map<number, (r: any) => void>;
//   agentInfo?: any;
//   agentCapabilities?: any;
//   authMethods?: any[];
//   protocolVersion: number;
//   sessionId?: string | null;
//   cwd: string;
//   modes?: { currentModeId?: string; availableModes?: any[] };
//   autoApprovePermissions: boolean;
// };

// export class AcpClient {
//   proc: any;
//   stdoutBuf = "";
//   state: State;
//   fileManager: FileManager;
//   terminalManager: TerminalManager;

//   constructor(
//     private adapterCmd = process.env.ACP_ADAPTER || "claude-code-acp --stdio"
//   ) {
//     this.state = {
//       nextId: 1,
//       pending: new Map(),
//       protocolVersion: 1,
//       cwd: process.cwd(),
//       autoApprovePermissions: true,
//     };

//     this.fileManager = new FileManager(this.state);
//     this.terminalManager = new TerminalManager(this.state.cwd);
//   }

//   start() {
//     const parts = this.adapterCmd.split(" ");
//     this.proc = spawn(parts, {
//       stdin: "pipe",
//       stdout: "pipe",
//       stderr: "inherit",
//     });

//     (async () => {
//       const reader = this.proc.stdout.getReader();
//       while (true) {
//         const { done, value } = await reader.read();
//         if (done) break;
//         if (!value) continue;
//         const text =
//           typeof value === "string"
//             ? value
//             : new TextDecoder().decode(value as Uint8Array);
//         this._onData(text);
//       }
//     })();

//     (async () => {
//       try {
//         const code = await this.proc.exitCode;
//         console.log("\n[ACP adapter exited]", code);
//       } catch (e) {
//         console.error("[ACP adapter exit error]", e);
//       }
//     })();
//   }

//   private _onData(chunk: string) {
//     this.stdoutBuf += chunk;
//     let idx: number;
//     while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
//       const line = this.stdoutBuf.slice(0, idx).trim();
//       this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
//       if (!line) continue;
//       let msg: any;
//       try {
//         msg = JSON.parse(line);
//       } catch (e) {
//         console.error("Failed parsing JSON:", line);
//         continue;
//       }
//       this._handleMessage(msg);
//     }
//   }

//   private _write(obj: any) {
//     try {
//       this.proc.stdin.write(JSON.stringify(obj) + "\n");
//     } catch (e) {
//       console.error("Failed writing to ACP adapter:", e);
//     }
//   }

//   sendRequest(method: string, params: any): Promise<any> {
//     const id = this.state.nextId++;
//     const msg = { jsonrpc: "2.0", id, method, params };
//     return new Promise((resolve) => {
//       this.state.pending.set(id, resolve);
//       this._write(msg);
//     });
//   }

//   sendNotification(method: string, params: any) {
//     this._write({ jsonrpc: "2.0", method, params });
//   }

//   sendResponse(id: number | string, result: any) {
//     this._write({ jsonrpc: "2.0", id, result });
//   }

//   sendError(id: number | string, code: number, message: string) {
//     this._write({ jsonrpc: "2.0", id, error: { code, message } });
//   }

//   private _handleMessage(msg: any) {
//     if (isResponse(msg)) {
//       const cb = this.state.pending.get(msg.id);
//       if (cb) {
//         this.state.pending.delete(msg.id);
//         if ("error" in msg) cb(msg.error);
//         else cb(msg.result);
//       }
//       return;
//     }

//     if (isRequest(msg)) {
//       this._handleRequest(msg).catch((e) => {
//         console.error("Request handling error:", e);
//         this.sendError(msg.id, 500, String(e));
//       });
//       return;
//     }

//     if (isNotification(msg)) {
//       this._handleNotification(msg);
//       return;
//     }

//     console.warn("Unknown message:", msg);
//   }

//   private async _handleRequest(msg: any) {
//     const { method, id } = msg;

//     switch (method) {
//       case "fs/read_text_file": {
//         const content = await this.fileManager.readTextFile(msg.params);
//         this.sendResponse(id, { content });
//         break;
//       }
//       case "fs/write_text_file": {
//         await this.fileManager.writeTextFile(msg.params);
//         this.sendResponse(id, null);
//         break;
//       }
//       case "terminal/create": {
//         const r = this.terminalManager.createTerminal(msg.params);
//         this.sendResponse(id, r);
//         break;
//       }
//       case "terminal/output": {
//         const r = await this.terminalManager.terminalOutput(
//           msg.params.terminalId
//         );
//         this.sendResponse(id, r);
//         break;
//       }
//       case "terminal/wait_for_exit": {
//         const r = await this.terminalManager.waitForExit(
//           msg.params.terminalId
//         );
//         this.sendResponse(id, r);
//         break;
//       }
//       case "terminal/kill": {
//         await this.terminalManager.kill(msg.params.terminalId);
//         this.sendResponse(id, null);
//         break;
//       }
//       case "terminal/release": {
//         await this.terminalManager.release(msg.params.terminalId);
//         this.sendResponse(id, null);
//         break;
//       }
//       case "session/request_permission": {
//         const options = msg.params.options || [];
//         const first = options[0];
//         const optionId = first?.optionId || "allow-once";
//         this.sendResponse(id, { outcome: { outcome: "selected", optionId } });
//         break;
//       }
//       default:
//         console.warn("Unhandled request:", method);
//         this.sendError(id, -32601, "Method not found");
//     }
//   }

//   private _handleNotification(msg: any) {
//     if (msg.method === "session/update") {
//       handleSessionUpdate(this, msg.params);
//       return;
//     }
//     console.log("Notification:", msg.method, msg.params);
//   }

//   // ---------------------------
//   // Initialization + auth logic
//   // ---------------------------
//   async initialize() {
//     const resp = await this.sendRequest("initialize", {
//       protocolVersion: this.state.protocolVersion,
//       clientCapabilities: {
//         fs: { readTextFile: true, writeTextFile: true },
//         terminal: true,
//       },
//       clientInfo: {
//         name: "sahil-acp-client",
//         title: "Sahil ACP Client",
//         version: "1.0.0",
//       },
//     });

//     this.state.agentCapabilities = resp.agentCapabilities;
//     this.state.agentInfo = resp.agentInfo;
//     this.state.authMethods = resp.authMethods ?? [];

//     console.log("Initialized with agent:", resp.agentInfo);
//     if (this.state.authMethods && this.state.authMethods.length > 0) {
//       console.log("Agent reported authMethods:", this.state.authMethods);
//     } else {
//       console.log("Agent reported no auth methods.");
//     }
//     return resp;
//   }

//   // Attempt CLI login automatically if possible, otherwise instruct user to run it.
//   private async runClaudeLoginCliIfAvailable(): Promise<boolean> {
//     // Check for a local install of anthropic cli in node_modules
//     const cliRelative = path.join(
//       process.cwd(),
//       "node_modules",
//       "@anthropic-ai",
//       "claude-agent-sdk",
//       "cli.js"
//     );

//     if (fs.existsSync(cliRelative)) {
//       console.log("Found local Claude CLI at:", cliRelative);
//       console.log("Launching login process: `node <cli.js> /login` (interactive)");

//       const proc = spawn([process.execPath, cliRelative, "/login"], {
//         stdin: "inherit",
//         stdout: "inherit",
//         stderr: "inherit",
//       });

//       try {
//         const code = await proc.exitCode;
//         console.log("Login process exited with code:", code);
//         return code === 0 || code === null;
//       } catch (e) {
//         console.error("Login CLI failed:", e);
//         return false;
//       }
//     }

//     // try global `claude` command (if installed)
//     try {
//       const testProc = spawn(["claude", "/login"], {
//         stdin: "inherit",
//         stdout: "inherit",
//         stderr: "inherit",
//       });
//       const code = await testProc.exitCode;
//       return code === 0 || code === null;
//     } catch {
//       // not found
//     }

//     return false;
//   }

//   // Ask the user to run login manually (blocking until Enter pressed)
//   private async askUserToRunLogin(): Promise<void> {
//     console.log("");
//     console.log("=== Authentication required by the agent ===");
//     console.log(
//       "The agent requests you run the Claude Code login flow. Run one of the following in another terminal:"
//     );
//     console.log("");
//     console.log("  npx @anthropic-ai/claude-agent-sdk /login");
//     console.log("  # or if installed globally:");
//     console.log("  claude /login");
//     console.log("");
//     console.log(
//       "After you complete the login flow, return here and press Enter to continue."
//     );

//     // wait for Enter
//     await new Promise<void>((res) => {
//       const rl = Bun.readableStreamToText(this.proc.stdin); // not used for prompt; fallback below
//       // Simple fallback: use stdin from process (sync prompt)
//       process.stdin.resume();
//       process.stdin.once("data", () => {
//         res();
//       });
//     });
//   }

//   // Authenticate if the agent advertised auth methods
//   async authenticateIfNeeded() {
//     const methods = this.state.authMethods ?? [];
//     if (!methods || methods.length === 0) {
//       // No auth required
//       return;
//     }

//     // Pick the first advertised method (common case)
//     const method = methods[0];
//     const methodId = method.id;
//     console.log("Agent requires authentication. methodId =", methodId);
//     // If the method looks like the Claude "login", attempt to run it
//     if (methodId === "claude-login") {
//       // try auto-run
//       const autoOk = await this.runClaudeLoginCliIfAvailable();
//       if (!autoOk) {
//         // Ask the user to run the login manually
//         await this.askUserToRunLogin();
//       }
//       // After login performed, call authenticate RPC to notify agent
//       try {
//         const resp = await this.sendRequest("authenticate", { methodId, data: {} });
//         console.log("Authenticate RPC result:", resp);
//       } catch (err) {
//         console.error("authenticate RPC failed:", err);
//         throw err;
//       }
//       return;
//     }

//     // Generic fallback: call authenticate with the advertised methodId and empty data
//     try {
//       const resp = await this.sendRequest("authenticate", { methodId: methodId, data: {} });
//       console.log("Authenticate RPC result:", resp);
//     } catch (err) {
//       console.error("authenticate RPC failed (generic):", err);
//       throw err;
//     }
//   }

//   // ---------------------------
//   // Session lifecycle
//   // ---------------------------
//   async createSession() {
//     const resp = await this.sendRequest("session/new", {
//       cwd: this.state.cwd,
//       mcpServers: [],
//     });

//     this.state.sessionId = resp.sessionId;
//     if (resp.modes) {
//       this.state.modes = resp.modes;
//       console.log("Available modes:", resp.modes.availableModes);
//       console.log("Current mode:", resp.modes.currentModeId);
//     }
//     console.log("Session created:", this.state.sessionId);
//     return resp;
//   }

//   async sendPrompt(text: string) {
//     if (!this.state.sessionId) throw new Error("No session ID");
//     const resp = await this.sendRequest("session/prompt", {
//       sessionId: this.state.sessionId,
//       prompt: [{ type: "text", text }],
//     });
//     console.log("[Prompt completed] stopReason:", resp?.stopReason);
//     return resp;
//   }

//   async setMode(modeId: string) {
//     if (!this.state.sessionId) return;
//     await this.sendRequest("session/set_mode", {
//       sessionId: this.state.sessionId,
//       modeId,
//     });
//   }

//   async cancelCurrentPrompt() {
//     if (!this.state.sessionId) return;
//     this.sendNotification("session/cancel", { sessionId: this.state.sessionId });
//   }
// }


// src/acp.ts

import { spawn } from "bun";
import { isNotification, isRequest, isResponse } from "./utils";
import { FileManager } from "./fileManager";
import { TerminalManager } from "./terminalManager";
import { handleSessionUpdate } from "./toolHandler";

export type State = {
  nextId: number;
  pending: Map<number, (r: any) => void>;
  agentInfo?: any;
  agentCapabilities?: any;
  clientCapabilities?: any;
  protocolVersion: number;
  sessionId?: string | null;
  cwd: string;
  modes?: { currentModeId?: string; availableModes?: any[] };
  autoApprovePermissions: boolean;
  usesApiKey: boolean;
};

export class AcpClient {
  proc: any;
  stdoutBuf = "";
  state: State;

  fileManager: FileManager;
  terminalManager: TerminalManager;

  constructor(
    private adapterCmd = process.env.ACP_ADAPTER ||
      "claude-code-acp --stdio"
  ) {
    this.state = {
      nextId: 1,
      pending: new Map(),
      protocolVersion: 1,
      cwd: process.cwd(),
      autoApprovePermissions: true,
      usesApiKey: Boolean(process.env.ANTHROPIC_API_KEY) // important!
    };

    this.fileManager = new FileManager(this.state);
    this.terminalManager = new TerminalManager(this.state.cwd);
  }

  start() {
    const parts = this.adapterCmd.split(" ");
    this.proc = spawn(parts, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    // read stdout
    (async () => {
      const reader = this.proc.stdout.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const text =
          typeof value === "string"
            ? value
            : new TextDecoder().decode(value as Uint8Array);

        this._onData(text);
      }
    })();

    // watch exit
    (async () => {
      try {
        const code = await this.proc.exitCode;
        console.log("\n[ACP adapter exited]", code);
      } catch (e) {
        console.error("[ACP adapter exit error]", e);
      }
    })();
  }

  private _onData(chunk: string) {
    this.stdoutBuf += chunk;
    let idx: number;

    while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
      const line = this.stdoutBuf.slice(0, idx).trim();
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      if (!line) continue;

      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        console.error("Failed parsing JSON from ACP:", line);
        continue;
      }
      this._handleMessage(msg);
    }
  }

  private _write(obj: any) {
    try {
      this.proc.stdin.write(JSON.stringify(obj) + "\n");
    } catch (e) {
      console.error("Failed to write to ACP:", e);
    }
  }

  sendRequest(method: string, params: any): Promise<any> {
    const id = this.state.nextId++;
    const msg = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve) => {
      this.state.pending.set(id, resolve);
      this._write(msg);
    });
  }

  sendNotification(method: string, params: any) {
    const msg = { jsonrpc: "2.0", method, params };
    this._write(msg);
  }

  sendResponse(id: number | string, result: any) {
    this._write({ jsonrpc: "2.0", id, result });
  }

  sendError(id: number | string, code: number, message: string) {
    this._write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private _handleMessage(msg: any) {
    if (isResponse(msg)) {
      const cb = this.state.pending.get(msg.id);
      if (cb) {
        this.state.pending.delete(msg.id);
        cb(msg.result ?? msg.error);
      }
      return;
    }

    if (isRequest(msg)) {
      this._handleRequest(msg).catch((e) => {
        console.error("Error handling request", e);
        this.sendError(msg.id, 500, String(e));
      });
      return;
    }

    if (isNotification(msg)) {
      this._handleNotification(msg);
      return;
    }
  }

  private async _handleRequest(msg: any) {
    const method = msg.method;
    const id = msg.id;

    switch (method) {
      case "fs/read_text_file":
        this.sendResponse(id, {
          content: await this.fileManager.readTextFile(msg.params)
        });
        break;

      case "fs/write_text_file":
        await this.fileManager.writeTextFile(msg.params);
        this.sendResponse(id, null);
        break;

      case "terminal/create":
        this.sendResponse(id, this.terminalManager.createTerminal(msg.params));
        break;

      case "terminal/output":
        this.sendResponse(
          id,
          await this.terminalManager.terminalOutput(msg.params.terminalId)
        );
        break;

      case "terminal/wait_for_exit":
        this.sendResponse(
          id,
          await this.terminalManager.waitForExit(msg.params.terminalId)
        );
        break;

      case "terminal/kill":
        await this.terminalManager.kill(msg.params.terminalId);
        this.sendResponse(id, null);
        break;

      case "terminal/release":
        await this.terminalManager.release(msg.params.terminalId);
        this.sendResponse(id, null);
        break;

      case "session/request_permission":
        // Auto-approve all tool calls
        const opt = msg.params.options?.[0];
        this.sendResponse(id, {
          outcome: {
            outcome: "selected",
            optionId: opt?.optionId || "allow-once"
          }
        });
        break;

      default:
        console.warn("[Unhandled request]", method);
        this.sendError(id, -32601, "Method not found");
    }
  }

  private _handleNotification(msg: any) {
    if (msg.method === "session/update") {
      handleSessionUpdate(this, msg.params);
      return;
    }
    console.log("[Notification]", msg.method, msg.params);
  }

  async initialize() {
    const resp = await this.sendRequest("initialize", {
      protocolVersion: this.state.protocolVersion,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: {
        name: "sahil-acp-client",
        title: "Sahil ACP Client",
        version: "1.0.0",
      },
    });

    this.state.agentCapabilities = resp.agentCapabilities;
    this.state.agentInfo = resp.agentInfo;

    console.log("Initialized with agent:", resp.agentInfo);

    if (this.state.usesApiKey) {
      console.log("Using ANTHROPIC_API_KEY → skipping authentication.");
    } else {
      console.log("No ANTHROPIC_API_KEY detected.");
      console.log("Agent may require login via Claude Code.");
    }

    return resp;
  }

  async createSession() {
    const resp = await this.sendRequest("session/new", {
      cwd: this.state.cwd,
      mcpServers: [],
      _meta: {
        disableBuiltInTools: false
      }
    });

    this.state.sessionId = resp.sessionId;
    this.state.modes = resp.modes;

    console.log("Available modes:", resp.modes.availableModes);
    console.log("Current mode:", resp.modes.currentModeId);
    console.log("Session created:", resp.sessionId);

    return resp;
  }

  async sendPrompt(text: string) {
    if (!this.state.sessionId) throw new Error("No session available");

    const resp = await this.sendRequest("session/prompt", {
      sessionId: this.state.sessionId,
      prompt: [{ type: "text", text }]
    });

    console.log("\n[Prompt completed]", resp);
    return resp;
  }

  async setMode(modeId: string) {
    if (!this.state.sessionId) return;
    await this.sendRequest("session/set_mode", {
      sessionId: this.state.sessionId,
      modeId
    });
  }

  async cancelCurrentPrompt() {
    if (!this.state.sessionId) return;
    this.sendNotification("session/cancel", {
      sessionId: this.state.sessionId
    });
  }
}
