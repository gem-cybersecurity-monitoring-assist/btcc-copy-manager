import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set([".git", ".next", ".vercel", "node_modules"]);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else files.push({ file: relative(root, absolute), data: await readFile(absolute, "utf8") });
  }
}

await walk(root);
process.stdout.write(JSON.stringify(files));
