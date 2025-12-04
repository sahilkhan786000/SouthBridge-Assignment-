// src/tui-client.tsx
import React, { useEffect, useRef, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { spawn } from "child_process";

type Msg = { role: "user" | "assistant" | "system"; text: string };
type ToolRequestPayload = {
  sessionId: string;
  toolId: string;
  tool: any;
  assistant_excerpt?: string;
  agent?: "chat" | "tool";
};

function useTerminalSize() {
  const get = () => {
    try {
      const [cols, rows] = process.stdout.getWindowSize();
      return { cols, rows };
    } catch {
      return { cols: 100, rows: 30 };
    }
  };
  const [size, setSize] = useState(get());
  useEffect(() => {
    const handler = () => setSize(get());
    process.stdout.on("resize", handler);
    return () => process.stdout.off("resize", handler);
  }, []);
  return size;
}

const theme = {
  text: "white",
  subtle: "gray",
  border: "cyanBright",
  glow: "magentaBright",
  user: "greenBright",
  ai: "magentaBright",
  popupBorder: "cyanBright",
  popupGlow: "magentaBright",
  tabActive: "yellowBright",
  tabInactive: "gray",
};

const MODEL_LIST = ["phi3", "llama3", "qwen2", "mistral", "deepseek-r1"];

function SpotlightPro() {
  const { exit } = useApp();
  const { cols, rows } = useTerminalSize();

  /* ---------- spawn agents ---------- */
  // Chat agent (your existing chat agent, assumed at src/agent-chat.ts)
  const chatAgentRef = useRef<any | null>(null);
  if (!chatAgentRef.current) {
    chatAgentRef.current = spawn(process.execPath, ["src/agent-chat.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const chatAgent = chatAgentRef.current;

  // Tool agent (we generate src/agent-tool.ts)
  const toolAgentRef = useRef<any | null>(null);
  if (!toolAgentRef.current) {
    toolAgentRef.current = spawn(process.execPath, ["src/agent-tool.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  const toolAgent = toolAgentRef.current;

  /* ---------- UI state ---------- */
  const [activeTab, setActiveTab] = useState<"chat" | "commands" | "help">("chat");

  const [input, setInput] = useState("");
  const [isStreamingChat, setIsStreamingChat] = useState(false);
  const [isStreamingTool, setIsStreamingTool] = useState(false);

  // separate message stores
  const [chatMessages, setChatMessages] = useState<Msg[]>([]);
  const [commandMessages, setCommandMessages] = useState<Msg[]>([]);

  // viewport starts
  const chatHeight = Math.max(6, rows - 14);
  const [chatViewportStart, setChatViewportStart] = useState(0);
  const [commandViewportStart, setCommandViewportStart] = useState(0);

  // session ids for each agent
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [toolSessionId, setToolSessionId] = useState<string | null>(null);

  // typing queues per agent
  const chatTypingQueueRef = useRef<string>("");
  const toolTypingQueueRef = useRef<string>("");

  // tool approval popup state (shared)
  const [toolPopupOpen, setToolPopupOpen] = useState(false);
  const [pendingTool, setPendingTool] = useState<ToolRequestPayload | null>(null);

  // model selection
  const [selectedModel, setSelectedModel] = useState<string>(MODEL_LIST[0]);

  // helper push
  const pushChat = (m: Msg) => {
    setChatMessages((prev) => {
      const next = [...prev, m];
      setTimeout(() => setChatViewportStart(Math.max(0, next.length - chatHeight)), 0);
      return next;
    });
  };
  const pushCommand = (m: Msg) => {
    setCommandMessages((prev) => {
      const next = [...prev, m];
      setTimeout(() => setCommandViewportStart(Math.max(0, next.length - chatHeight)), 0);
      return next;
    });
  };

  /* ---------- Initialize both agents and create sessions ---------- */
  useEffect(() => {
    // CHAT AGENT: listen stdout
    const onChatStdout = (buf: Buffer) => {
      const raw = buf.toString();
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "initialized") {
            pushChat({ role: "system", text: "Chat agent initialized." });
          } else if (msg.type === "session_created") {
            setChatSessionId(msg.payload.sessionId);
            pushChat({ role: "system", text: `Chat session: ${msg.payload.sessionId}` });
          } else if (msg.type === "stream_chunk") {
            chatTypingQueueRef.current += msg.payload.chunk;
            setIsStreamingChat(true);
            // ensure an assistant bubble exists
            setChatMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") return prev;
              return [...prev, { role: "assistant", text: "" }];
            });
          } else if (msg.type === "response") {
            chatTypingQueueRef.current += msg.payload?.text ?? "";
            setIsStreamingChat(false);
            setChatMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") return prev;
              return [...prev, { role: "assistant", text: "" }];
            });
          } else if (msg.type === "tool_permission_request") {
            setPendingTool({ ...msg.payload, agent: "chat" });
            setToolPopupOpen(true);
            pushChat({ role: "system", text: `Tool requested: ${msg.payload.tool?.name ?? JSON.stringify(msg.payload.tool)}` });
          } else if (msg.type === "tool_result") {
            pushChat({ role: "system", text: `Tool executed: ${JSON.stringify(msg.payload.result)}` });
          } else if (msg.type === "tool_rejected") {
            pushChat({ role: "system", text: `Tool call rejected (toolId=${msg.payload.toolId})` });
          } else if (msg.type === "error") {
            pushChat({ role: "system", text: `Error: ${msg.message || JSON.stringify(msg)}` });
          }
        } catch (e) {
          // ignore non-json or partial lines
        }
      }
    };

    chatAgent.stdout.on("data", onChatStdout);

    // initialize + create new session for chat agent (use selectedModel)
    chatAgent.stdin.write(JSON.stringify({ type: "initialize", payload: {} }) + "\n");
    setTimeout(() => {
      chatAgent.stdin.write(JSON.stringify({ type: "new_session", payload: { model: selectedModel, workspace: "./workspace" } }) + "\n");
    }, 120);

    // cleanup on unmount
    return () => {
      try {
        chatAgent.kill();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  useEffect(() => {
    // TOOL AGENT: listen stdout
    const onToolStdout = (buf: Buffer) => {
      const raw = buf.toString();
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "initialized") {
            pushCommand({ role: "system", text: "Tool agent initialized." });
          } else if (msg.type === "session_created") {
            setToolSessionId(msg.payload.sessionId);
            pushCommand({ role: "system", text: `Tool session: ${msg.payload.sessionId}` });
          } else if (msg.type === "stream_chunk") {
            toolTypingQueueRef.current += msg.payload.chunk;
            setIsStreamingTool(true);
            setCommandMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") return prev;
              return [...prev, { role: "assistant", text: "" }];
            });
          } else if (msg.type === "response") {
            toolTypingQueueRef.current += msg.payload?.text ?? "";
            setIsStreamingTool(false);
            setCommandMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") return prev;
              return [...prev, { role: "assistant", text: "" }];
            });
          } else if (msg.type === "tool_permission_request") {
            setPendingTool({ ...msg.payload, agent: "tool" });
            setToolPopupOpen(true);
            pushCommand({ role: "system", text: `Tool requested: ${msg.payload.tool?.name ?? JSON.stringify(msg.payload.tool)}` });
          } else if (msg.type === "tool_result") {
            pushCommand({ role: "system", text: `Tool executed: ${JSON.stringify(msg.payload.result)}` });
          } else if (msg.type === "tool_rejected") {
            pushCommand({ role: "system", text: `Tool call rejected (toolId=${msg.payload.toolId})` });
          } else if (msg.type === "error") {
            pushCommand({ role: "system", text: `Error: ${msg.message || JSON.stringify(msg)}` });
          }
        } catch (e) {
          // ignore non-json or partial lines
        }
      }
    };

    toolAgent.stdout.on("data", onToolStdout);

    // initialize + create new session for tool agent (use selectedModel)
    toolAgent.stdin.write(JSON.stringify({ type: "initialize", payload: {} }) + "\n");
    setTimeout(() => {
      toolAgent.stdin.write(JSON.stringify({ type: "new_session", payload: { model: selectedModel, workspace: "./workspace" } }) + "\n");
    }, 120);

    return () => {
      try {
        toolAgent.kill();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  /* ---------- When selectedModel changes, notify agents (set_model) ---------- */
  useEffect(() => {
    // send set_model to chat agent if session exists
    if (chatSessionId) {
      try {
        chatAgent.stdin.write(JSON.stringify({ type: "set_model", payload: { sessionId: chatSessionId, model: selectedModel } }) + "\n");
        pushChat({ role: "system", text: `Model switched to ${selectedModel}` });
      } catch {}
    }
    // send set_model to tool agent if session exists
    if (toolSessionId) {
      try {
        toolAgent.stdin.write(JSON.stringify({ type: "set_model", payload: { sessionId: toolSessionId, model: selectedModel } }) + "\n");
        pushCommand({ role: "system", text: `Model switched to ${selectedModel}` });
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);

  /* ---------- Typing animation consumers for both agents ---------- */
  useEffect(() => {
    const t = setInterval(() => {
      const q = chatTypingQueueRef.current;
      if (!q) return;
      const take = q.slice(0, 4);
      chatTypingQueueRef.current = q.slice(take.length);

      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          const updated = [...prev.slice(0, -1), { ...last, text: last.text + take }];
          setChatViewportStart(Math.max(0, updated.length - chatHeight));
          return updated;
        } else {
          const updated = [...prev, { role: "assistant", text: take }];
          setChatViewportStart(Math.max(0, updated.length - chatHeight));
          return updated;
        }
      });

      if (chatTypingQueueRef.current.length === 0 && !isStreamingChat) {
        // finished streaming for chat
      }
    }, 40);
    return () => clearInterval(t);
  }, [isStreamingChat, chatHeight]);

  useEffect(() => {
    const t = setInterval(() => {
      const q = toolTypingQueueRef.current;
      if (!q) return;
      const take = q.slice(0, 4);
      toolTypingQueueRef.current = q.slice(take.length);

      setCommandMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant") {
          const updated = [...prev.slice(0, -1), { ...last, text: last.text + take }];
          setCommandViewportStart(Math.max(0, updated.length - chatHeight));
          return updated;
        } else {
          const updated = [...prev, { role: "assistant", text: take }];
          setCommandViewportStart(Math.max(0, updated.length - chatHeight));
          return updated;
        }
      });

      if (toolTypingQueueRef.current.length === 0 && !isStreamingTool) {
        // finished streaming for tool
      }
    }, 40);
    return () => clearInterval(t);
  }, [isStreamingTool, chatHeight]);

  /* ---------- Keyboard handling ---------- */
  useInput((inputKey, key) => {
    // If tool approval popup is open -> restrict to Y/N only
    if (toolPopupOpen && pendingTool) {
      const c = inputKey.toLowerCase();
      if (c === "y") {
        // approve -> send to proper agent
        const payload = { type: "approve_tool", payload: { sessionId: pendingTool.sessionId, toolId: pendingTool.toolId, approve: true } };
        if (pendingTool.agent === "chat") {
          chatAgent.stdin.write(JSON.stringify(payload) + "\n");
          pushChat({ role: "system", text: `Approved tool: ${pendingTool.tool.name}` });
        } else {
          toolAgent.stdin.write(JSON.stringify(payload) + "\n");
          pushCommand({ role: "system", text: `Approved tool: ${pendingTool.tool.name}` });
        }
        setToolPopupOpen(false);
        setPendingTool(null);
      } else if (c === "n") {
        const payload = { type: "approve_tool", payload: { sessionId: pendingTool.sessionId, toolId: pendingTool.toolId, approve: false } };
        if (pendingTool.agent === "chat") {
          chatAgent.stdin.write(JSON.stringify(payload) + "\n");
          pushChat({ role: "system", text: `Rejected tool: ${pendingTool.tool.name}` });
        } else {
          toolAgent.stdin.write(JSON.stringify(payload) + "\n");
          pushCommand({ role: "system", text: `Rejected tool: ${pendingTool.tool.name}` });
        }
        setToolPopupOpen(false);
        setPendingTool(null);
      }
      return;
    }

    // Tab switching:
    
    if (key.ctrl && inputKey === "a") {
      setActiveTab("chat");
      return;
    }
    if (key.ctrl && inputKey === "b") {
      setActiveTab("commands");
      return;
    }
    if (key.ctrl && inputKey === "h") {
      setActiveTab("help");
      return;
    }

    // Model cycling: Press 'l' to cycle models (lowercase L)
    if (key.ctrl && inputKey === "l" && !toolPopupOpen) {
      const idx = MODEL_LIST.indexOf(selectedModel);
      const next = MODEL_LIST[(idx + 1) % MODEL_LIST.length];
      setSelectedModel(next);
      return;
    }

    // scrolling keys when in chat or commands
    if (activeTab === "chat") {
      if (key.pageUp) {
        setChatViewportStart((s) => Math.max(0, s - Math.floor(chatHeight / 2)));
        return;
      }
      if (key.pageDown) {
        setChatViewportStart((s) => Math.min(Math.max(0, chatMessages.length - chatHeight), s + Math.floor(chatHeight / 2)));
        return;
      }
      if (key.upArrow) {
        setChatViewportStart((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setChatViewportStart((s) => Math.min(Math.max(0, chatMessages.length - chatHeight), s + 1));
        return;
      }
    }

    if (activeTab === "commands") {
      if (key.pageUp) {
        setCommandViewportStart((s) => Math.max(0, s - Math.floor(chatHeight / 2)));
        return;
      }
      if (key.pageDown) {
        setCommandViewportStart((s) => Math.min(Math.max(0, commandMessages.length - chatHeight), s + Math.floor(chatHeight / 2)));
        return;
      }
      if (key.upArrow) {
        setCommandViewportStart((s) => Math.max(0, s - 1));
        return;
      }
      if (key.downArrow) {
        setCommandViewportStart((s) => Math.min(Math.max(0, commandMessages.length - chatHeight), s + 1));
        return;
      }
    }

    // Ctrl+C => quit (kill agents)
    if (key.ctrl && inputKey === "c") {
      try {
        chatAgent.kill();
      } catch {}
      try {
        toolAgent.kill();
      } catch {}
      exit();
    }
  });

  /* ---------- Input submit ---------- */
  const onSubmit = (v: string) => {
    if (!v.trim()) return;
    if (activeTab === "chat") {
      pushChat({ role: "user", text: v });
      chatAgent.stdin.write(JSON.stringify({ type: "prompt", payload: { sessionId: chatSessionId, text: v, stream: true } }) + "\n");
      setIsStreamingChat(true);
    } else if (activeTab === "commands") {
      pushCommand({ role: "user", text: v });
      toolAgent.stdin.write(JSON.stringify({ type: "prompt", payload: { sessionId: toolSessionId, text: v, stream: true } }) + "\n");
      setIsStreamingTool(true);
    }
    setInput("");
  };

  /* ---------- Visible slices ---------- */
  const visibleChat = chatMessages.slice(chatViewportStart, chatViewportStart + chatHeight);
  const visibleCmd = commandMessages.slice(commandViewportStart, commandViewportStart + chatHeight);

  /* ---------- Tool popup ---------- */
  const ToolPopup = () => {
    if (!toolPopupOpen || !pendingTool) return null;
    return (
      <Box borderStyle="round" borderColor={theme.popupBorder} padding={1} flexDirection="column" width={Math.max(40, Math.min(cols - 10, 80))}>
        <Text bold color={theme.popupGlow}>🛠 Tool Request (from {pendingTool.agent})</Text>
        <Box marginTop={1}><Text>{JSON.stringify(pendingTool.tool, null, 2)}</Text></Box>
        <Box marginTop={1}><Text color={theme.subtle}>Approve this tool call? (Y / N)</Text></Box>
      </Box>
    );
  };

  /* ---------- Render ---------- */
  return (
    <Box flexDirection="column" padding={1}>
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={theme.glow}>✨ ACP Client UI — Model: </Text>
        <Text bold color="yellowBright"> {selectedModel} </Text>
      </Box>

      <Box borderStyle="round" borderColor={theme.border} padding={1} width={cols - 6} alignSelf="center" marginBottom={1}>
        {!toolPopupOpen ? (
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={onSubmit}
            placeholder={activeTab === "chat" ? `Ask anything… (model: ${selectedModel})` : `Enter command or request (TOOL_CALL only)…`}
          />
        ) : (
          <Text color={theme.subtle}>Tool approval pending — press Y or N</Text>
        )}
      </Box>

      <Box justifyContent="center" marginBottom={1}>
        <Text color={activeTab === "chat" ? theme.tabActive : theme.tabInactive}>[Ctrl + a] Chat</Text>
        <Text> </Text>
        <Text color={activeTab === "commands" ? theme.tabActive : theme.tabInactive}>[Ctrl + b] Commands</Text>
        <Text> </Text>
        <Text color={activeTab === "help" ? theme.tabActive : theme.tabInactive}>[Ctrl + h] Help</Text>
        <Text> </Text>
        <Text color={theme.subtle}>[Ctrl + l] Cycle model</Text>
      </Box>

      <Box borderStyle="round" borderColor={theme.border} padding={1} height={rows - 14} flexDirection="column" overflow="hidden">
        {toolPopupOpen && pendingTool ? (
          <Box justifyContent="center" alignItems="center" flexDirection="column" flexGrow={1}><ToolPopup /></Box>
        ) : activeTab === "help" ? (
          <Box flexDirection="column">
            <Text color={theme.subtle}>Help</Text>
            <Box marginTop={1}><Text>- Ctrl + a → Switch to chat</Text></Box>
            <Box><Text>- Ctrl +  b → Commands (TOOL_CALL)</Text></Box>
            <Box><Text>- Ctrl + h → Show help</Text></Box>
            <Box><Text>- Ctrl + l → Cycle models (currently: {selectedModel})</Text></Box>
            <Box><Text>- PageUp / PageDown / ↑ / ↓ → Scroll chat/commands</Text></Box>
            <Box><Text>- While popup open: Y to approve, N to reject</Text></Box>
            <Box><Text>- Ctrl+C → Quit</Text></Box>
          </Box>
        ) : activeTab === "commands" ? (
          <Box flexDirection="column">
            {visibleCmd.length === 0 ? (
              <Text color={theme.subtle}>No commands yet — switch to Commands and type a request.</Text>
            ) : (
              visibleCmd.map((m, i) => (
                <Box key={commandViewportStart + i} flexDirection="column" marginBottom={1}>
                  <Text bold color={m.role === "user" ? theme.user : m.role === "assistant" ? theme.ai : theme.subtle}>
                    {m.role === "user" ? "You" : m.role === "assistant" ? "AI" : "SYS"}
                  </Text>
                  <Text wrap="wrap" color={theme.text}>{m.text}</Text>
                </Box>
              ))
            )}

            <Box marginTop={1} justifyContent="space-between">
              <Text color={theme.subtle}>{isStreamingTool ? "Streaming…" : `Connected (Commands) — model: ${selectedModel}`}</Text>
              <Text color={theme.subtle}>{`Showing ${Math.min(commandMessages.length, chatHeight)} of ${commandMessages.length}`}</Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            {visibleChat.length === 0 ? (
              <Text color={theme.subtle}>No messages yet — type to start a conversation.</Text>
            ) : (
              visibleChat.map((m, i) => (
                <Box key={chatViewportStart + i} flexDirection="column" marginBottom={1}>
                  <Text bold color={m.role === "user" ? theme.user : m.role === "assistant" ? theme.ai : theme.subtle}>
                    {m.role === "user" ? "You" : m.role === "assistant" ? "AI" : "SYS"}
                  </Text>
                  <Text wrap="wrap" color={theme.text}>{m.text}</Text>
                </Box>
              ))
            )}

            <Box marginTop={1} justifyContent="space-between">
              <Text color={theme.subtle}>{isStreamingChat ? "Streaming…" : `Connected (Chat) — model: ${selectedModel}`}</Text>
              <Text color={theme.subtle}>{`Showing ${Math.min(chatMessages.length, chatHeight)} of ${chatMessages.length}`}</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

render(<SpotlightPro />);
