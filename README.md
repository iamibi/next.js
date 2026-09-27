# Reproduction: a React render per streamed chunk once a `useServerInsertedHTML` callback is registered

Created from `examples/reproduction-template` (App Router). Next.js is not patched. The number of internal renders is read from Next.js' own OpenTelemetry spans (`NEXT_OTEL_VERBOSE=1`).

| File | Change from the template |
| --- | --- |
| `package.json` | Added `@opentelemetry/api` (`~1.9.0`) and `@opentelemetry/sdk-trace-node` (pinned to `2.11.0`, its last release; OpenTelemetry JS 3.x replaces it with `@opentelemetry/sdk-trace`). Everything else is the template's: `"next": "canary"`, `react`/`react-dom` `19.3.0`. |
| `instrumentation.ts` | New. Loads `span-counter.ts` in the Node.js runtime only. |
| `span-counter.ts` | New. An in-process `SpanProcessor` that counts spans per request (one trace per request) and prints one `[span-count]` line when the request span ends. It exports nothing. |
| `app/style-registry.tsx` | New. A dependency-free client registry with the same shape as the styled-jsx registry in the Next.js CSS-in-JS guide: `useServerInsertedHTML(() => { const styles = registry.styles(); registry.flush(); return <>{styles}</> })`. |
| `app/streaming-content.tsx` | New. `?boundaries=N` (default 5, max 50) Suspense boundaries whose async children resolve after 100 ms, 200 ms, and so on. |
| `app/with-registry/layout.tsx`, `app/with-registry/page.tsx` | New. The streaming page wrapped in the registry. |
| `app/without-registry/page.tsx` | New. The same streaming page without a registry (control). |
| `app/page.tsx` | Replaced `return null` with links to the two routes. |
| `app/favicon.ico`, `.codesandbox/` | Removed (not relevant; the CodeSandbox task runs `next dev`, and this has to be run with `next start`). |

`app/layout.tsx`, `next.config.ts`, `tsconfig.json` and `.gitignore` are unchanged from the template.

## What is counted

Span names are defined in `packages/next/src/server/lib/trace/constants.ts` (`AppRenderSpan`):

- `AppRender.renderToReadableStream` is emitted for every React DOM server (Fizz) render in `renderToNodeFizzStream`. That covers the page's own HTML render and every render done by `getServerInsertedHTML()`.
- `AppRender.renderToNodeFizzStream` wraps only the page's own HTML render. It is printed as `page_renders` as a sanity check and should be `1`.
- Neither span is in `NextVanillaSpanAllowlist`, so both are only emitted with `NEXT_OTEL_VERBOSE=1`.

Each `[span-count]` line prints `server_inserted_html_renders = fizz_renders - 1`, which is the number of React renders that `getServerInsertedHTML()` did for that request.

This render is covered by OpenTelemetry spans, so no `process.cpuUsage()` fallback is needed.

## Steps

Requires Node.js >= 20.9.0 (the `engines` range of `next`).

```bash
npm install
npx next info            # paste this output into the issue
npx next build
NEXT_OTEL_VERBOSE=1 npx next start
```

In a second terminal:

```bash
curl -s -o /dev/null "http://localhost:3000/without-registry?boundaries=5"
curl -s -o /dev/null "http://localhost:3000/with-registry?boundaries=5"
curl -s -o /dev/null "http://localhost:3000/with-registry?boundaries=20"
```

Then read the `[span-count]` lines in the `next start` terminal. There is one line per request, printed after the response has finished streaming.

Use `next start`. `next dev` is not what this reproduction measures, because the dev server has its own dev-only span recording.

The first `next build` rewrites `tsconfig.json` (it adds `.next/dev/types/**/*.ts` to `include` and reformats the file). That is normal Next.js behavior and does not affect the counts.

## What to observe

| Route | Current (`next@canary`) | Expected |
| --- | --- | --- |
| `/without-registry?boundaries=5` | `server_inserted_html_renders` is at most 1 (the first flush, which carries the polyfill `<script>`) | Same |
| `/with-registry?boundaries=5` | `server_inserted_html_renders` is much larger than 1. It equals the number of `getServerInsertedHTML()` calls: one per streamed HTML or inline Flight (`<script>`) chunk, plus one at the end of the stream | At most 1: only the first flush, which carries the registry's `<style>`, renders anything |
| `/with-registry?boundaries=20` | Grows with the number of boundaries | Still at most 1 |

### Observed

`next start`, requests sent one at a time, 5 requests per row (3 for webpack). Every request gave the same count, and `page_renders` was always 1. No `ended outside of a tracked request` line appeared.

| `server_inserted_html_renders` | `boundaries=1` | `boundaries=5` | `boundaries=10` | `boundaries=20` |
| --- | --- | --- | --- | --- |
| `/without-registry`, `next@16.4.0-canary.48` (Turbopack) | 1 | 1 | 1 | 1 |
| `/with-registry`, `next@16.4.0-canary.48` (Turbopack) | 6 | 14 | 24 | 44 |
| `/with-registry`, `next@16.4.0-canary.48` (`next build --webpack`) | 6 | 14 | not run | 44 |
| `/without-registry`, `next@16.3.6` (latest stable) | 1 | 1 | 1 | 1 |
| `/with-registry`, `next@16.3.6` (latest stable) | 6 | 14 | 24 | 44 |

- On `/with-registry` the count is `2 × boundaries + 4`. That is consistent with each boundary streaming one HTML chunk and one inline Flight `<script>` chunk (the `boundaries=5` response has 5 `<div hidden id="S:` segments and 6 `self.__next_f.push` scripts).
- Three concurrent `/with-registry` requests and three concurrent `/without-registry` requests were still counted separately (14 and 1 each), so the per-trace counting holds under concurrency too.

Trimmed server output (`next@16.4.0-canary.48`; `next@16.3.6` printed the same lines):

```
[span-count] target=/without-registry?boundaries=5 fizz_renders=2 page_renders=1 server_inserted_html_renders=1
[span-count] target=/with-registry?boundaries=5 fizz_renders=15 page_renders=1 server_inserted_html_renders=14
[span-count] target=/with-registry?boundaries=20 fizz_renders=45 page_renders=1 server_inserted_html_renders=44
```

The HTML response is the same in both cases. The registry's `<style>` appears exactly once:

```bash
curl -s "http://localhost:3000/with-registry?boundaries=5" | grep -o '<style>[^<]*</style>'
# <style>body{font-family:system-ui,sans-serif}</style>
```

Exact counts depend on how the response is chunked, so a different page or Next.js version can give different numbers. A similar measurement on `bench/basic-app` in the Next.js repo (with temporary counters, not spans) showed 4 to 14.2 renders per request on canary, and 1 with the fix.

If a line `[span-count] AppRender.renderToReadableStream ended outside of a tracked request` appears, the render ran without the request's trace context. In that case send the requests one at a time and count those lines between two requests instead. This did not happen on the versions above.

## Why an empty result still costs a render

- After the first flush, the registry's callback returns `<>{[]}</>`. That renders no HTML.
- `renderServerInsertedHTML()` wraps every callback result in a keyed `Fragment`, so its result is never an empty array once a callback is registered.
- `getServerInsertedHTML()` only skips rendering when that array is empty. Otherwise it runs a full `renderToPipeableStream` (plus a `setImmediate`) and decodes the result to `''`.
- The head insertion transform awaits `getServerInsertedHTML()` for every chunk of the response.

Real registries return the same kind of empty value once their styles are flushed:

- styled-jsx: `registry.styles()` returns `[]`, and the documented registry returns `<>{styles}</>`.
- styled-components >= 6.1.12: `ServerStyleSheet.getStyleElement()` returns `[]` when the sheet is empty. 6.1.0 to 6.1.11 always return a `<style>` element (checked at the `v6.1.0` and `v6.1.11` tags), so those versions do not benefit from the fix.
- emotion and MUI's `AppRouterCacheProvider`: the callback returns `null` when nothing new was inserted.

## Testing the fix with this reproduction

From a Next.js checkout on the fix branch (see `contributing/core/developing.md`, "Testing a local Next.js version on an application"):

```bash
pnpm build-all
pnpm pack-next --tar && pnpm unpack-next path/to/this/repro
```

Then repeat the steps above in this directory.

The fix branch itself was not packed into this app. As a check of the fix's logic, the compiled `renderServerInsertedHTML` in published `next@16.4.0-canary.48` (`dist/compiled/next-server/app-page*.runtime.prod.js`) was replaced, in a throwaway copy, by an equivalent of the fix commit's `isEmptyNode` filter. The same `.next` build output was then served with the original and the patched runtime:

- `/with-registry` dropped to `server_inserted_html_renders=1` for `boundaries` = 1, 5, 10 and 20 (from 6, 14, 24 and 44). `/without-registry` stayed at 1.
- The HTML of all eight route and `boundaries` combinations was byte-identical between the two runtimes (same SHA-1).
