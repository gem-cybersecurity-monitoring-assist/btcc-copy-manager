import test from "node:test";
import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Legacy diagnostic GET endpoints performed account login or created billed
// browser sessions. They must not be exposed by the deployed public app.
test("no publicly routable internal diagnostic handlers exist", async () => {
  const root = join(process.cwd(), "src/app/api/v1/internal");
  const paths: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const file = join(dir, name);
      if ((await stat(file)).isDirectory()) await visit(file);
      else if (/^(route|page)\.(ts|tsx|js|jsx)$/.test(name)) paths.push(file);
    }
  }
  await visit(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  assert.deepEqual(paths, [], "no internal diagnostic route may be publicly routable");
});
