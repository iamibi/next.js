// Runs the whole reproduction: `next build`, `next start`, then the request
// sequence from README.md, and prints a verdict.
//
//   node repro.mjs [--skip-build]
//
// Environment variables (all optional):
//   PORT              port for `next start` (default 3123)
//   RENDER_DELAY_MS   how long getStaticProps takes after reading the CMS (default 3000)
//   PUBLISH_AFTER_MS  delay between the stale request and the publish (default 750)
//   CHECK_AFTER_MS    delay between res.revalidate() returning and the final GET / (default 1000)
//
// Exit codes: 0 expected behavior, 1 bug reproduced, 2 inconclusive (the race
// was not hit), 3 /api/revalidate failed, 4 setup error.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const nextVersion = require("next/package.json").version;
const dataDir = path.join(root, ".data");
const rendersFile = path.join(dataDir, "renders.jsonl");

const PORT = Number(process.env.PORT ?? 3123);
const RENDER_DELAY_MS = Number(process.env.RENDER_DELAY_MS ?? 3000);
const PUBLISH_AFTER_MS = Number(process.env.PUBLISH_AFTER_MS ?? 750);
const CHECK_AFTER_MS = Number(process.env.CHECK_AFTER_MS ?? 1000);
// `revalidate` returned by getStaticProps in pages/index.tsx.
const REVALIDATE_S = 5;
const BASE = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  RENDER_DELAY_MS: String(RENDER_DELAY_MS),
  NEXT_TELEMETRY_DISABLED: "1",
};

let t0 = Date.now();
const at = (t) => `${t >= t0 ? "+" : ""}${((t - t0) / 1000).toFixed(2)}s`;
const log = (msg) => console.log(`[repro ${at(Date.now())}] ${msg}`);

async function getPage() {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  const props = match ? JSON.parse(match[1]).props.pageProps : {};
  return {
    status: res.status,
    cache: res.headers.get("x-nextjs-cache"),
    ...props,
  };
}

const describePage = (page) =>
  `status=${page.status} x-nextjs-cache=${page.cache} version=${page.version} ` +
  `(CMS read at ${at(page.readAt)}, render finished at ${at(page.renderedAt)})`;

function startServer() {
  const server = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(PORT), "-H", "127.0.0.1"],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const stream of [server.stdout, server.stderr]) {
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) console.log(`[next  ${at(Date.now())}] ${line}`);
    });
  }
  return server;
}

async function waitForServer(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next start exited with code ${server.exitCode}`);
    }
    try {
      // Any HTTP response means the server is up. Don't request `/` here, as
      // that could start a regeneration.
      await fetch(`${BASE}/__ready`, { method: "HEAD" });
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("next start did not respond within 60s");
}

async function run() {
  log(`next@${nextVersion}, RENDER_DELAY_MS=${RENDER_DELAY_MS}, revalidate=${REVALIDATE_S}s`);

  log("2. GET / (may start a regeneration if the build output is already stale)");
  log(`   ${describePage(await getPage())}`);

  const settleMs = REVALIDATE_S * 1000 + RENDER_DELAY_MS + 2000;
  log(`3. Wait ${settleMs / 1000}s, so / is stale and no regeneration is in flight`);
  await sleep(settleMs);

  log("4. GET / (served stale, starts a background regeneration that reads the CMS, then renders)");
  const stale = await getPage();
  log(`   ${describePage(stale)}`);

  await sleep(PUBLISH_AFTER_MS);
  log("5. POST /api/publish (new content while that regeneration is still rendering)");
  const publishRes = await fetch(`${BASE}/api/publish`, { method: "POST" });
  const published = await publishRes.json();
  log(`   status=${publishRes.status} published version ${published.version}`);

  log("6. POST /api/revalidate, which calls res.revalidate('/')");
  const revalidateSentAt = Date.now();
  const revalidateRes = await fetch(`${BASE}/api/revalidate`, { method: "POST" });
  const revalidateBody = await revalidateRes.json();
  const revalidateDoneAt = Date.now();
  log(
    `   status=${revalidateRes.status} body=${JSON.stringify(revalidateBody)} ` +
      `took ${revalidateDoneAt - revalidateSentAt}ms`,
  );

  await sleep(CHECK_AFTER_MS);
  log("7. GET / (first request after res.revalidate() reported success)");
  const after = await getPage();
  log(`   ${describePage(after)}`);

  const renders = fs
    .readFileSync(rendersFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  log("getStaticProps runs during `next start` (from .data/renders.jsonl):");
  for (const r of renders) {
    log(`   version=${r.version} CMS read at ${at(r.readAt)}, finished at ${at(r.renderedAt)}`);
  }

  if (revalidateRes.status !== 200 || revalidateBody.revalidated !== true) {
    log("RESULT: ERROR, /api/revalidate did not report success (see the server output above)");
    return 3;
  }

  // The race needs a regeneration that read the CMS before the publish and was
  // still rendering when res.revalidate() was called.
  const inFlight = renders.find(
    (r) => r.readAt < published.publishedAt && r.renderedAt > revalidateSentAt,
  );
  if (stale.cache !== "STALE" || !inFlight) {
    log(
      "RESULT: INCONCLUSIVE, no regeneration that read the old version was still " +
        "rendering when res.revalidate() was called, so this run did not hit the race. " +
        "Run it again, or raise RENDER_DELAY_MS (e.g. RENDER_DELAY_MS=6000).",
    );
    return 2;
  }

  const newRenders = renders.filter(
    (r) => r.version >= published.version && r.readAt <= revalidateDoneAt,
  );
  log(
    `   in flight when res.revalidate() was called: a regeneration that read version ${inFlight.version}`,
  );
  log(
    `   getStaticProps runs that read version ${published.version} before res.revalidate() returned: ${newRenders.length}`,
  );

  if (after.version === published.version) {
    log(`RESULT: EXPECTED BEHAVIOR, / serves version ${after.version}`);
    return 0;
  }
  log(
    `RESULT: BUG REPRODUCED, res.revalidate('/') reported success, but / serves ` +
      `version ${after.version} (read before version ${published.version} was published)` +
      (newRenders.length === 0
        ? ". getStaticProps never ran for the on-demand revalidation."
        : "."),
  );
  return 1;
}

async function main() {
  if (!process.argv.includes("--skip-build")) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    const build = spawnSync(process.execPath, [nextBin, "build"], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error(`next build failed (${build.status})`);
  }
  // Only record the renders that happen in `next start`.
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(rendersFile, "");

  const server = startServer();
  process.on("SIGINT", () => {
    server.kill();
    process.exit(130);
  });
  try {
    await waitForServer(server);
    t0 = Date.now();
    return await run();
  } finally {
    server.kill();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(4);
  },
);
