// src/llm.ts
export class Ollama {
	base = "http://127.0.0.1:11434";

	extract(json: any) {
		return json?.message?.content || json?.response || json?.content || "";
	}

	async chat(model: string, prompt: string) {
		const res = await fetch(`${this.base}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: prompt }],
				stream: true,
			}),
		});

		let reader = res.body!.getReader();
		let buffer = "";
		let out = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;

			buffer += new TextDecoder().decode(value);
			let lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const l of lines) {
				if (!l.trim()) continue;
				try {
					out += this.extract(JSON.parse(l));
				} catch {}
			}
		}
		return out.trim();
	}

	async chatStream(model: string, prompt: string, onChunk: (c: string) => void) {
		const res = await fetch(`${this.base}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: prompt }],
				stream: true,
			}),
		});

		let reader = res.body!.getReader();
		let buffer = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;

			buffer += new TextDecoder().decode(value);

			let lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const l of lines) {
				if (!l.trim()) continue;

				try {
					const content = this.extract(JSON.parse(l));
					if (content) onChunk(content);
				} catch {}
			}
		}
	}
}
