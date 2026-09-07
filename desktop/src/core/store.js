const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const COLLECTIONS = new Set(["profile", "jobs", "queue", "events", "settings"]);

class JsonStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
  }

  file(name) {
    if (!COLLECTIONS.has(name)) throw new Error(`不允许的数据集合：${name}`);
    return path.join(this.directory, `${name}.json`);
  }

  async read(name, fallback) {
    await this.init();
    try {
      return JSON.parse(await fs.readFile(this.file(name), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(fallback);
      throw error;
    }
  }

  async write(name, value) {
    await this.init();
    const target = this.file(name);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      try {
        await fs.writeFile(temporary, contents, "utf8");
        // Replace in one operation: readers must never observe a missing target.
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    return this.writeChain;
  }
}

module.exports = { JsonStore };
