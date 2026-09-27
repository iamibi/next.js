// Requests N distinct paths of the ISR route /blog/[slug] and reports the
// server's heap, measured after a forced GC by /api/heap, as it goes.
//
//   node scripts/hit.mjs [--n 100000] [--steps 10] [--concurrency 16]
//                        [--base http://localhost:3000] [--prefix <run id>]
//                        [--recheck 0]
//
// --prefix  Slug prefix. Defaults to a new value per run, so every run requests
//           paths the server hasn't seen before.
// --recheck After the run, request the first K paths of this run again and
//           count their `x-nextjs-cache` values (HIT / STALE / MISS).
//
// Requires Node.js 20.9 or later (global fetch, util.parseArgs).
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    n: { type: "string", default: "100000" },
    steps: { type: "string", default: "10" },
    concurrency: { type: "string", default: "16" },
    base: { type: "string", default: "http://localhost:3000" },
    prefix: { type: "string", default: Date.now().toString(36) },
    recheck: { type: "string", default: "0" },
  },
});

const n = Number(values.n);
const steps = Math.max(1, Math.min(Number(values.steps), n));
const concurrency = Number(values.concurrency);
const base = values.base.replace(/\/$/, "");
const prefix = values.prefix;
const recheck = Math.min(Number(values.recheck), n);

const MiB = 1024 * 1024;
const slugPath = (i) => `/blog/${prefix}-${i}`;

// Minimum of a few forced-GC readings, to drop allocations that are still in
// flight when a reading is taken.
async function heapUsed() {
  let min = Infinity;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${base}/api/heap`);
    if (!res.ok) throw new Error(`/api/heap responded with ${res.status}`);
    const body = await res.json();
    if (!body.gcExposed) {
      throw new Error(
        "gc is not exposed in the server. Start it with NODE_OPTIONS=--expose-gc.",
      );
    }
    min = Math.min(min, body.heapUsed);
  }
  return min;
}

async function hitRange(from, to, statuses) {
  let next = from;
  async function worker() {
    while (next < to) {
      const i = next++;
      let key;
      try {
        const res = await fetch(`${base}${slugPath(i)}`);
        await res.arrayBuffer();
        key = String(res.status);
      } catch (err) {
        key = `error:${err.cause?.code ?? err.name}`;
      }
      statuses[key] = (statuses[key] ?? 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

const fmt = (bytes) => (bytes / MiB).toFixed(1).padStart(8);

console.log(
  `base=${base} n=${n} concurrency=${concurrency} paths=${slugPath(0)}..${slugPath(n - 1)}`,
);
const baseline = await heapUsed();
console.log("   paths  heap MiB  delta MiB  bytes/path");
console.log(`${"0".padStart(8)}  ${fmt(baseline)}  ${fmt(0)}           -`);

const statuses = {};
const samples = [{ paths: 0, heapUsed: baseline }];
const started = Date.now();
for (let step = 1; step <= steps; step++) {
  const from = Math.floor(((step - 1) * n) / steps);
  const to = Math.floor((step * n) / steps);
  await hitRange(from, to, statuses);
  const heap = await heapUsed();
  samples.push({ paths: to, heapUsed: heap });
  const delta = heap - baseline;
  console.log(
    `${String(to).padStart(8)}  ${fmt(heap)}  ${fmt(delta)}  ${String(Math.round(delta / to)).padStart(10)}`,
  );
}
const seconds = (Date.now() - started) / 1000;
console.log(
  `statuses: ${JSON.stringify(statuses)} in ${seconds.toFixed(0)}s (${Math.round(n / seconds)} req/s)`,
);

let recheckResult;
if (recheck > 0) {
  // Let more than the 1 second default revalidate pass, so a path that lost
  // its stored cache control is reported as STALE rather than HIT.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  recheckResult = {};
  for (let i = 0; i < recheck; i++) {
    const res = await fetch(`${base}${slugPath(i)}`);
    await res.arrayBuffer();
    const key = res.headers.get("x-nextjs-cache") ?? `none(${res.status})`;
    recheckResult[key] = (recheckResult[key] ?? 0) + 1;
  }
  console.log(
    `recheck of the first ${recheck} paths (x-nextjs-cache): ${JSON.stringify(recheckResult)}`,
  );
}

console.log(
  "RESULT " +
    JSON.stringify({ base, prefix, n, concurrency, seconds, statuses, samples, recheck: recheckResult }),
);
