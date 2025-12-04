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

---

### 🔹 NDJSON Format

ACP messages are sent as **newline-delimited JSON**:

```json
{"type":"initialize","payload":{}}
{"type":"session_created","payload":{"sessionId":"abc"}}
{"type":"stream_chunk","payload":{"chunk":"hello"}}
