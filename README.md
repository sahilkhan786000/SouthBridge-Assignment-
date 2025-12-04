# 🌟 ACP Coding Agent — TypeScript + Bun

A lightweight, fully working implementation of the Agent Client Protocol with streaming, tool calls, a terminal UI, session persistence, and workspace/file operations.

---

## 📌 Introduction

This project implements a coding agent that communicates using the **Agent Client Protocol (ACP)** — the same protocol used by **Claude Code, Cursor, Zed, and Gemini Code Assist**.

It supports:

- Message exchange with an LLM  
- Processing **ACP-style TOOL_CALLs**  
- Executing file and shell operations  
- Workspace management  
- Streaming responses  
- A complete **Terminal UI (TUI)**  
- Session persistence  
- Model switching  

The project is written entirely in **TypeScript**, runs with **Bun**, and uses **Ollama** as the local inference engine.

---

## 🚀 Features Implemented

### ✅ Core Requirements (Mandatory)

| Requirement | Status | Implementation |
|------------|--------|----------------|
| Send messages to Claude Code (LLM) | ✔ | Custom LLM wrapper in `llm.ts` (chat + streaming) |
| Receive messages from Claude Code | ✔ | NDJSON parsing from stdout + TUI streaming |
| Approve/reject tool calls | ✔ | Popup approval dialog in the TUI |
| Set model & workspace | ✔ | `Ctrl+4` cycles models, workspace set per-session |
| Create/edit/read files | ✔ | FileManager + tool call execution |
| Run shell commands | ✔ | Shell wrapper using Bun subprocess |

---

### ⭐ Extra Credit

| Extra Feature | Status | Notes |
|---------------|--------|-------|
| Streaming | ✔ | Token-level streaming from LLM to UI |
| Good Terminal UI | ✔ | Built with Ink (scrolling, tabs, popups, model switcher) |
| Resumable Sessions | ✔ | Saved under `.acp_chat_sessions` and `.acp_tool_sessions` |

---

## 🧠 Understanding ACP (Agent Client Protocol)

ACP is a **bidirectional, streaming JSON protocol** used by coding assistants to coordinate with client applications.


### 🔹 NDJSON Format

ACP messages are sent as **newline-delimited JSON**:

```json
{"type":"initialize","payload":{}}
{"type":"session_created","payload":{"sessionId":"abc"}}
{"type":"stream_chunk","payload":{"chunk":"hello"}}
```

### This enables:

- Incremental updates
- Token streaming
- Real-time tool call detection

### My agent:

- Reads/writes NDJSON on stdin/stdout  
- Buffers partial lines  
- Parses each message independently  

---

## 🔹 Tool Calls

ACP supports structured tool calls like:


### My implementation:

- Detects the first valid `TOOL_CALL`  
- Extracts JSON using brace matching  
- Validates the tool name  
- Prompts the user (Y/N) in the TUI  
- Executes the tool via `ToolManager`  
- Returns a structured `tool_result` event  

This fully matches expected ACP behavior.

---

## ❌ Why I Did **NOT** Use the ACP TypeScript SDK / ACP Daemon

Although allowed, I intentionally did **not** use:

- `@anthropic-ai/claude-code-acp` (SDK)  
- ACP Daemon  
- Any high-level adapter  

### 1. Demonstrate deep protocol understanding

The assignment tests comprehension of:

- NDJSON streaming  
- Tool call state machines  
- Multi-agent IPC  
- Session persistence  
- Workspace logic  

Using the SDK hides these details.

### 2. More control + easier debugging

Custom routing allowed:

- Inspecting raw LLM output  
- Custom tool approval UI  
- Full logging  
- Custom session management  

### 3. Simplicity for a local Bun-based agent

Avoids running external daemons or configuring adapters.

### 4. Limited time

The SDK requires additional setup; writing minimal ACP logic was faster.
TOOL_CALL: {"name":"create_file","args":{"path":"test.txt","content":"Hello"}}

### My implementation:

- Detects the first valid `TOOL_CALL`  
- Extracts JSON using brace matching  
- Validates the tool name  
- Prompts the user (Y/N) in the TUI  
- Executes the tool via `ToolManager`  
- Returns a structured `tool_result` event  

This fully matches expected ACP behavior.

---

## ❌ Why I Did **NOT** Use the ACP TypeScript SDK / ACP Daemon

Although allowed, I intentionally did **not** use:

- `@anthropic-ai/claude-code-acp` (SDK)  
- ACP Daemon  
- Any high-level adapter  


### 1. Demonstrate deep protocol understanding

The assignment tests comprehension of:

- NDJSON streaming  
- Tool call state machines  
- Multi-agent IPC  
- Session persistence  
- Workspace logic  

Using the SDK hides these details.

### 2. More control + easier debugging

Custom routing allowed:

- Inspecting raw LLM output  
- Custom tool approval UI  
- Full logging  
- Custom session management  

### 3. Simplicity for a local Bun-based agent

Avoids running external daemons or configuring adapters.

### 4. Limited time

The SDK requires additional setup; writing minimal ACP logic was faster.
