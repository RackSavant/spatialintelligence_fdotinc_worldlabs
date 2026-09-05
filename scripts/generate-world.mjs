#!/usr/bin/env node
// Generate a Marble world from a text prompt, poll until done, and download
// the .spz into public/worlds/ so the Spark scene can load it.
//
//   npm run world -- "a mystical forest with glowing mushrooms"
//   npm run world -- "a derelict space station" --model marble-1.1-plus --name Station

import { writeFile, mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const API = "https://api.worldlabs.ai/marble/v1";
const KEY = process.env.WORLDLABS_API_KEY;

if (!KEY) {
  console.error("WORLDLABS_API_KEY is not set. Copy .env.example to .env and fill it in,");
  console.error("then run:  set -a && . ./.env && set +a && npm run world -- \"your prompt\"");
  process.exit(1);
}

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const prompt = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")).join(" ");

if (!prompt) {
  console.error('Usage: npm run world -- "your text prompt" [--model marble-1.1] [--name "Display Name"]');
  process.exit(1);
}

const model = flag("model", "marble-1.1");
const displayName = flag("name", prompt.slice(0, 60));

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "WLT-Api-Key": KEY, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}\n${await res.text()}`);
  }
  return res.json();
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

console.log(`model: ${model}\nprompt: ${prompt}\n`);

const { operation_id } = await api("/worlds:generate", {
  method: "POST",
  body: JSON.stringify({
    display_name: displayName,
    model,
    world_prompt: { type: "text", text_prompt: prompt },
  }),
});
console.log(`operation: ${operation_id}`);

let op;
const startedAt = Date.now();
for (;;) {
  op = await api(`/operations/${operation_id}`);
  if (op.done) break;
  const pct = op.metadata?.progress ?? op.metadata?.progress_percent;
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  process.stdout.write(`\r  generating… ${pct != null ? `${pct}% ` : ""}(${mins}m elapsed)   `);
  await new Promise((r) => setTimeout(r, 10_000));
}
process.stdout.write("\n");

if (op.error) {
  console.error("generation failed:", JSON.stringify(op.error, null, 2));
  process.exit(1);
}

const world = op.response;
console.log(`world_id: ${world.world_id}`);
console.log(`marble:   ${world.world_marble_url}`);
if (op.cost) console.log(`cost:     ${JSON.stringify(op.cost.line_items ?? op.cost)}`);

const spzUrls = world.assets?.splats?.spz_urls;
if (!spzUrls || !Object.keys(spzUrls).length) {
  console.error("\nNo spz_urls on the world. Full assets payload:");
  console.error(JSON.stringify(world.assets, null, 2));
  process.exit(1);
}

console.log(`\nspz variants: ${Object.keys(spzUrls).join(", ")}`);

await mkdir("public/worlds", { recursive: true });
await writeFile(`public/worlds/${slug(displayName)}.json`, JSON.stringify(world, null, 2));

for (const [variant, url] of Object.entries(spzUrls)) {
  const out = `public/worlds/${slug(displayName)}--${slug(variant)}.spz`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  ! ${variant}: ${res.status}`);
    continue;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  console.log(`  saved ${out}`);
}

console.log(`\nLoad it:  npm run dev  then open  http://localhost:5173/?splat=/worlds/<file>.spz`);
