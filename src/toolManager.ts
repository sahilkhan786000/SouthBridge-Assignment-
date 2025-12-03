import { FileManager } from "./fileManager";
import { Shell } from "./shell";

export class ToolManager {
	file: FileManager;
	shell: Shell;

	constructor(file: FileManager, shell: Shell) {
		this.file = file;
		this.shell = shell;
	}

	async handleToolCall(call: { name: string; args?: any }) {
		const { name, args = {} } = call;

		switch (name) {
			case "create_file":
				return await this.file.create(args.path, args.content ?? "");
			case "read_file":
				return await this.file.read(args.path);
			case "edit_file":
				return await this.file.edit(args.path, args.content ?? "");
			case "run_shell":
				return await this.shell.run(args.command);
			default:
				return { error: "unknown_tool", tool: name };
		}
	}
}
