// src/shell.ts
import { exec } from "node:child_process";

export class Shell {
	run(cmd: string, opts?: { cwd?: string }): Promise<string> {
		return new Promise((resolve) => {
			const isWin = process.platform === "win32";
			const shell = isWin ? "powershell.exe" : "sh";
			exec(cmd, { shell, cwd: opts?.cwd }, (err, stdout, stderr) => {
				if (err) return resolve(stderr ?? String(err));
				resolve(stdout ?? "");
			});
		});
	}
}
