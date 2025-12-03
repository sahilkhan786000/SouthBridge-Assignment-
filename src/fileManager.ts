// src/fileManager.ts
import fs from "node:fs/promises";
import path from "node:path";

export class FileManager {
  base: string;
  constructor(base?: string) {
    this.base = base ?? path.join(process.cwd(), "workspace");
  }

  resolve(p: string) {
    const full = path.resolve(this.base, p);
    if (!full.startsWith(path.resolve(this.base))) throw new Error("path outside workspace");
    return full;
  }

  async ensureWorkspace(base?: string) {
    if (base) this.base = base;
    await fs.mkdir(this.base, { recursive: true });
  }

  async create(p: string, content: string) {
    const full = this.resolve(p);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return { ok: true, path: full };
  }

  async read(p: string) {
    const full = this.resolve(p);
    return await fs.readFile(full, "utf8");
  }

  async edit(p: string, content: string) {
    const full = this.resolve(p);
    await fs.writeFile(full, content, "utf8");
    return { ok: true, path: full };
  }
}
