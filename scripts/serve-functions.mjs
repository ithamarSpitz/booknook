// Serves the Edge Functions on the local stack. The secrets file stays outside the repo.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = process.env.BOOKNOOK_ENV_FILE ?? resolve("..", "book-discovery-plan", ".env.local");
if (!existsSync(envFile)) {
  console.error(`Secrets file not found: ${envFile}. Set BOOKNOOK_ENV_FILE to the file holding HARDCOVER_API_KEY.`);
  process.exit(1);
}
const result = spawnSync("npx", ["supabase", "functions", "serve", "--env-file", envFile, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
