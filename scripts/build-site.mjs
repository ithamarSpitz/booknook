// Copies public/ to a publish folder and stamps every local module and
// stylesheet reference with ?v=<version>. GitHub Pages lets browsers cache
// files for 10 minutes, so without this a visit right after a deploy can mix an
// old cached module with new ones and fail to load (missing export).
//
// Usage: node scripts/build-site.mjs <dest> [version]   (version defaults to the git short hash)
import { execSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dest, versionArg] = process.argv.slice(2);
if (!dest) {
  console.error("Usage: node scripts/build-site.mjs <dest> [version]");
  process.exit(1);
}
const version = versionArg ?? execSync("git rev-parse --short HEAD").toString().trim();
const out = resolve(dest);

// Keep the publish repo's .git and .nojekyll; replace everything else.
for (const name of readdirSync(out, { withFileTypes: true }).map((e) => e.name)) {
  if (name !== ".git" && name !== ".nojekyll") rmSync(join(out, name), { recursive: true, force: true });
}
cpSync(resolve("public"), out, { recursive: true });

const stamp = (path) => `${path}?v=${version}`;
const moduleRef = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'?]+\.js)\2/g;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".js")) {
      const text = readFileSync(path, "utf8");
      writeFileSync(path, text.replace(moduleRef, (_m, lead, q, spec) => `${lead}${q}${stamp(spec)}${q}`));
    }
  }
}
walk(join(out, "js"));

const indexPath = join(out, "index.html");
const html = readFileSync(indexPath, "utf8").replace(
  /\b(href|src)="((?:css|js)\/[^"?]+\.(?:css|js))"/g,
  (_m, attr, path) => `${attr}="${stamp(path)}"`,
);
writeFileSync(indexPath, html);
console.log(`Built ${out} at version ${version}`);
