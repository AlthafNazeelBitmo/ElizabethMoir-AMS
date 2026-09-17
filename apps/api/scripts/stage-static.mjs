// Gathers the static files the Vercel deployment serves next to the API:
// the built web app, plus whatever is in public/ (robots.txt). Vercel is
// pointed at the result, so one deployment carries both the register and
// the API, on one origin — which is what the session cookie requires.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const webDist = resolve(apiRoot, "..", "web", "dist");
const publicDir = resolve(apiRoot, "public");
const out = resolve(apiRoot, ".static");

if (!existsSync(resolve(webDist, "index.html"))) {
  console.error(
    `stage-static: no web build at ${webDist}. Run the web build first.`,
  );
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(webDist, out, { recursive: true });
if (existsSync(publicDir)) cpSync(publicDir, out, { recursive: true });

console.log(`stage-static: web app and public/ staged in ${out}`);
