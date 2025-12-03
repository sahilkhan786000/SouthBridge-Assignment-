#!/usr/bin/env bun
import { Agent } from "./agent";

const agent = new Agent();

/* ---------- Helper to send NDJSON messages ---------- */
function send(obj: any) {
	process.stdout.write(JSON.stringify(obj) + "\n");
}


const lineStream =
	(Bun as any)?.stdin?.lines ??
	(async function* () {
		const rl = require("readline").createInterface({
			input: process.stdin,
		});
		for await (const l of rl) yield l;
	})();

/* ---------- Main Loop ---------- */
(async () => {
	for await (const raw of lineStream) {
		const line = String(raw).trim();
		if (!line) continue;

		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			send({
				type: "error",
				message: "invalid-json",
				raw: line,
			});
			continue;
		}

		try {
			switch (msg.type) {
				/* ---------------- Initialize ---------------- */
				case "initialize":
					send({
						type: "initialized",
						payload: await agent.initialize(), 
					});
					break;

				/* ---------------- Create Session ---------------- */
				case "new_session":
					send({
						type: "session_created",
						payload: await agent.newSession(msg.payload ?? {}),
					});
					break;

				/* ---------------- Prompt / Chat ---------------- */
				case "prompt":
					send({
						type: "response",
						payload: await agent.handlePrompt(msg.payload ?? {}),
					});
					break;

				/* ---------------- Approve Tool ---------------- */
				case "approve_tool":
					send({
						type: "tool_permission_response",
						payload: await agent.handleToolPermissionResponse(msg.payload ?? {}),
					});
					break;

				/* ---------------- Set Model ---------------- */
				case "set_model":
					send({
						type: "set_model_result",
						payload: await agent.setModel(msg.payload ?? {}),
					});
					break;

				/* ---------------- Set Workspace ---------------- */
				case "set_workspace":
					send({
						type: "set_workspace_result",
						payload: await agent.setWorkspace(msg.payload ?? {}),
					});
					break;

				/* ---------------- Unknown ---------------- */
				default:
					send({
						type: "error",
						message: "unknown-message-type",
						details: msg.type,
					});
			}
		} catch (err: any) {
			send({
				type: "error",
				message: String(err?.stack ?? err),
			});
		}
	}
})();
