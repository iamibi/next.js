# On-demand revalidation during a background regeneration keeps the older content

Minimal Pages Router reproduction, based on
[`reproduction-template-pages`](https://github.com/vercel/next.js/tree/canary/examples/reproduction-template-pages).

`res.revalidate("/")` is called while a stale-while-revalidate regeneration of `/` is
still rendering. That regeneration read the CMS before the new content was published.
`res.revalidate()` resolves successfully, but `/` keeps serving the content that the
older regeneration read.

## What's in here

| File                       | Purpose                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/cms.ts`               | A fake CMS. The published version is a number in `.data/cms.json`. Each `getStaticProps` run is appended to `.data/renders.jsonl`.                                                 |
| `pages/index.tsx`          | ISR page (`revalidate: 5`). `getStaticProps` reads the CMS version **first**, then waits `RENDER_DELAY_MS` (default 3000 ms) to simulate a slow render, then returns the version. |
| `pages/api/publish.ts`     | `POST` bumps the CMS version (a content publish).                                                                                                                                  |
| `pages/api/revalidate.ts`  | The CMS webhook: `await res.revalidate("/")`, then `{ revalidated: true }`.                                                                                                        |
| `repro.mjs`                | Runs `next build`, `next start` and the request sequence below, then prints a verdict.                                                                                            |

Nothing else was changed from the template (`.codesandbox/` and the favicon were removed;
`react`/`react-dom` are pinned to `19.3.0` as in `reproduction-template`).

## Run it

Requires Node.js >= 20.9.

```bash
npm install
npm run repro            # next build + next start + the steps below
# npm run repro -- --skip-build   (reuse an existing .next build)
```

Exit code: `0` expected behavior, `1` bug reproduced, `2` inconclusive (the timing
window was missed), `3` `/api/revalidate` failed, `4` setup error.

A full run resets `.data/`, so the CMS starts at version 1. `--skip-build` keeps
`.data/cms.json`, so the versions continue from the previous run (the regeneration
reads N and the publish makes it N+1). The verdict accounts for that.

This needs `next start`. `next dev` runs `getStaticProps` on every request, so it
doesn't show the problem.

## Steps (what `repro.mjs` does)

1. `next build`. The CMS starts at version 1, so the prerendered `/` shows version 1.
2. `next start`. Then `GET /` once.
3. Wait 10 s (`revalidate` 5 s + `RENDER_DELAY_MS` + 2 s). `/` is now stale and no
   regeneration is running.
4. `GET /`. It responds with `x-nextjs-cache: STALE` and starts a background
   regeneration. That regeneration reads version 1, then renders for 3 s.
5. After 0.75 s, while that regeneration is still rendering, `POST /api/publish`. The
   CMS is now at version 2.
6. Right after that, `POST /api/revalidate`. It responds `200 {"revalidated":true}`.
7. After 1 s, `GET /`.

Manual equivalent. Start from a fresh CMS, then run `next start` on port 3000:

```bash
rm -rf .data && npm run build && npm start
```

Then, in a second terminal:

```bash
curl -s -o /dev/null -D - http://localhost:3000/ | grep -i x-nextjs-cache    # step 2
sleep 10
curl -s -o /dev/null -D - http://localhost:3000/ | grep -i x-nextjs-cache    # step 4: STALE
sleep 0.75
curl -s -X POST http://localhost:3000/api/publish; echo                      # step 5
curl -s -X POST http://localhost:3000/api/revalidate; echo                   # step 6
sleep 1
curl -s http://localhost:3000/ | grep -o 'id="version">[0-9]*'               # step 7
```

## What to look for

**Current (`next@canary`, and the other affected versions under [Verified](#verified)):**

- Step 6: `/api/revalidate` returns `200 {"revalidated":true}`. It takes about as long
  as the rest of the regeneration from step 4 (about 2.25 s), not a full render.
- Step 7: `/` shows **version 1**, with a "CMS read at" time **before** the publish.
- `.data/renders.jsonl` and the `[getStaticProps]` server log have **no** render that
  read version 2 before `res.revalidate()` returned. The on-demand revalidation never
  ran `getStaticProps`. It reused the regeneration from step 4 and saved that result.
- `/` only shows version 2 after a later time-based regeneration. With
  `revalidate: false` it would stay on version 1 until the next successful on-demand
  revalidation.

**Expected:**

- Step 7: `/` shows **version 2**, because `res.revalidate()` reported success after
  the publish.
- `getStaticProps` runs for the on-demand revalidation and reads version 2, even though
  the regeneration from step 4 is still rendering. Step 6 then takes a full render
  (about 3 s).

## Timing and nondeterminism

The bug only shows up when the on-demand revalidation arrives **while** another
regeneration of the same page is still rendering. `repro.mjs` checks this precondition
using the render log. If step 4 wasn't `STALE`, or the regeneration had already finished
when `/api/revalidate` was called, it prints `INCONCLUSIVE` and exits with `2`.

- The window is `RENDER_DELAY_MS - PUBLISH_AFTER_MS`, about 2.25 s by default. On a
  slow or loaded machine, raise it: `RENDER_DELAY_MS=6000 npm run repro`.
- Timestamps come from `Date.now()` in the server and in `repro.mjs`. Both run on the
  same machine.
- When the precondition holds, canary's code always makes the on-demand request join the
  render that's in flight, so the outcome itself shouldn't vary. Hitting the
  precondition depends on real timers, though. Re-run once before drawing conclusions
  from a single `INCONCLUSIVE` or unexpected result.

## Verified

`npm run repro` with the defaults, Node.js 20, macOS (Apple Silicon),
`react`/`react-dom` `19.3.0`:

| `next`             | Result                         | Step 6 (`res.revalidate`) | Step 7 serves |
| ------------------ | ------------------------------ | ------------------------- | ------------- |
| `16.4.0-canary.48` | bug reproduced, 5 of 5 runs    | 2245–2255 ms              | version 1     |
| `16.3.6` (latest)  | bug reproduced, 3 of 3 runs    | 2234–2246 ms              | version 1     |
| `16.0.0`           | bug reproduced                 | 2245 ms                   | version 1     |
| `15.5.26`          | bug reproduced                 | 2241 ms                   | version 1     |
| `15.5.11`          | bug reproduced                 | 2233 ms                   | version 1     |
| `15.5.10`          | expected behavior              | 3025 ms                   | version 2     |
| `15.5.1-canary.18` | bug reproduced                 | 2244 ms                   | version 1     |
| `15.5.1-canary.17` | expected behavior              | 3028 ms                   | version 2     |

No run was `INCONCLUSIVE`. On `16.4.0-canary.48`, two more checks also reproduced it:
`RENDER_DELAY_MS=6000 npm run repro -- --skip-build` (step 6 took 5233 ms), and the
manual `curl` steps above (step 6 took about 2.2 s, step 7 showed version 1).
