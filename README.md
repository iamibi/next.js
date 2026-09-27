# Reproduction: ISR cache controls are kept for every distinct path on `next start`

Based on [`examples/reproduction-template`](https://github.com/vercel/next.js/tree/canary/examples/reproduction-template) (App Router). Only these files differ from the template:

| File | Purpose |
| --- | --- |
| `next.config.ts` | `cacheMaxMemorySize: 0`, so the in-memory ISR cache (a bounded LRU) doesn't add to the heap |
| `app/blog/[slug]/page.tsx` | ISR route: `revalidate = 3600`, `generateStaticParams()` returns `[]`, `dynamicParams` is left at its default (`true`), so every slug is generated on its first request |
| `app/api/heap/route.ts` | Dynamic route handler that runs `globalThis.gc()` and returns `process.memoryUsage().heapUsed` |
| `scripts/hit.mjs` | Requests N distinct `/blog/<slug>` paths (16 at a time) and reads `/api/heap` before, during and after |

The template's `app/page.tsx`, `favicon.ico` and `.codesandbox/` were removed. The issue needs `next start`, so `next dev` and CodeSandbox don't reproduce it.

## Steps

Requires Node.js 20.9 or later.

1. Install dependencies:
   ```bash
   pnpm install    # or: npm install
   ```
2. Build:
   ```bash
   pnpm build      # next build
   ```
3. Start the production server with `gc` exposed:
   ```bash
   NODE_OPTIONS=--expose-gc pnpm start
   # if your Node.js rejects the flag in NODE_OPTIONS:
   # node --expose-gc node_modules/next/dist/bin/next start
   ```
4. Check that GC is exposed. The response should contain `"gcExposed":true`:
   ```bash
   curl -s http://localhost:3000/api/heap
   ```
5. In a second terminal, request 100,000 distinct paths:
   ```bash
   node scripts/hit.mjs --n 100000
   ```
   The script prints `heapUsed` after a forced GC every 10,000 paths, then a final `RESULT {...}` line in JSON.
6. Wait a few minutes, then read the heap again. Then repeat step 5, which uses a new slug prefix on each run:
   ```bash
   curl -s http://localhost:3000/api/heap
   node scripts/hit.mjs --n 100000
   ```
7. Optional: re-request the first K paths of a run and count their `x-nextjs-cache` values:
   ```bash
   node scripts/hit.mjs --n 100000 --recheck 1000
   ```

Options for `scripts/hit.mjs`: `--n`, `--steps`, `--concurrency` (default 16), `--base` (default `http://localhost:3000`), `--prefix`, `--recheck`.

## What to observe

**Current behavior (`next@canary`):**

- `heapUsed` after a forced GC grows with the number of distinct paths requested, by about 0.2 KB per path on average. Expect roughly +15 to +25 MiB per 100,000 paths.
- The growth is a staircase rather than a smooth line: about 0.1 KB per path, plus a jump of a few MiB each time the number of stored paths passes a power of two (65,536, 131,072, ...). The jumps line up with the map that holds them doubling its backing store.
- During roughly the first 60,000 to 70,000 paths, up to about 8 MiB comes on top of that from the router's filesystem lookup cache. That cache is a bounded LRU, so it stops growing.
- The heap never comes back down: not after waiting (step 6), and not after further runs, which keep adding to it. The only thing that frees it is a server restart.
- The growth happens even with `cacheMaxMemorySize: 0`, which disables the in-memory ISR cache.
- With `--recheck`, the re-requested paths are `HIT`.

**Expected behavior:**

- Per-path in-memory state is bounded, so once a server has seen enough distinct paths, `heapUsed` levels off instead of growing with every new path.

**Measured** with `next@16.4.0-canary.48`, `react@19.3.0`, Node.js 20 (`--expose-gc` via `NODE_OPTIONS`), macOS on Apple Silicon. A 1,000-path warm-up run came first, then a 100,000-path run, about 8.5 minutes idle, and a 50,000-path run. Heap is the minimum of three `/api/heap` readings, in MiB; paths are cumulative, including the warm-up:

| Distinct paths | `heapUsed` (MiB) | Note |
| --- | --- | --- |
| 0 | 22.3 | fresh server |
| 1,000 | 29.0 | after the warm-up |
| 21,000 | 36.4 | |
| 51,000 | 43.7 | |
| 61,000 | 45.3 | |
| 71,000 | 49.6 | step, after passing 65,536 paths |
| 101,000 | 52.2 | end of the 100,000-path run: +23.1 MiB for 100,000 paths |
| 101,000 | 51.8 | read again right after the run, and again after 8.5 minutes idle: unchanged |
| 131,000 | 54.9 | |
| 141,000 | 59.2 | step, after passing 131,072 paths |
| 151,000 | 60.2 | end of the 50,000-path run: +8.3 MiB for 50,000 paths |

- Every request returned `200`, at 200 to 300 requests per second.
- `--recheck 1000` after the 100,000-path run: `{"HIT":1000}`.
- The 100,000-path run took 330 s. Budget about 6 minutes per 100,000 paths, plus the disk cleanup below.

## Notes

- Each generated path is also written to the ISR disk cache under `.next/server/app/blog/`: `<slug>.html`, `<slug>.rsc`, `<slug>.meta`, and a `<slug>.segments/` directory with 4 more files. That is 7 files and 2 directories per path. 101,000 paths came to about 707,000 files and 2.7 GB on disk (APFS). Check free disk space before a large run. Reset between runs with `rm -rf .next && pnpm build`; deleting that many files is slow (about 15 minutes for roughly 1.8 million files here). Disk usage is separate from the heap growth shown here.
- The per-path state is the process-wide map in [`SharedCacheControls`](https://github.com/vercel/next.js/blob/bd6bdd1aa30943c8962cfea06f6cc9ae7f13296f/packages/next/src/server/lib/incremental-cache/shared-cache-controls.external.ts#L15). [`IncrementalCache.set`](https://github.com/vercel/next.js/blob/bd6bdd1aa30943c8962cfea06f6cc9ae7f13296f/packages/next/src/server/lib/incremental-cache/index.ts#L783-L788) adds one entry for every path it writes, before the entry reaches the cache handler. Nothing removes entries outside of tests.
