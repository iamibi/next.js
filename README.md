# Reproduction: reused `fetch` options object loses `next` (revalidate/tags)

Created from `examples/reproduction-template` (App Router). Changes from the template:

| File | Change |
| --- | --- |
| `next.config.ts` | added `cacheComponents: true` |
| `app/fetch-options.ts` | new: one module-level `RequestInit` constant, `{ next: { revalidate: 3600, tags: ["shared"] } }` |
| `app/page.tsx` | two awaited `fetch` calls that both pass that same constant |
| `app/favicon.ico` | removed (not relevant) |

`package.json` is the template's own: `"next": "canary"`, `react`/`react-dom` `19.3.0`.

## Verified with

| `next` | Bundler | `next build` | `next dev` (values across requests) |
| --- | --- | --- | --- |
| `16.4.0-canary.48` (the `canary` dist-tag on 2026-09-26) | Turbopack (default) | fails, error below | change on every request |
| `16.4.0-canary.48` | webpack (`--webpack`) | fails, same error | change on every request |
| `16.3.6` (the `latest` dist-tag on 2026-09-26) | Turbopack (default) | fails, same error | change on every request |

`react`/`react-dom` `19.3.0`, Node.js 20, macOS on Apple Silicon. To test stable, run `npm install next@16.3.6` (or `next@latest`) after `npm install`.

## Steps

Requires Node.js >= 20.9.0 (the `engines` range of `next`).

```bash
npm install
npx next info            # paste this output into the issue
```

### 1. `next build`

```bash
rm -rf .next             # see "Why rm -rf .next" below
npx next build
```

| | What to look for |
| --- | --- |
| Current (canary) | Build fails while generating static pages. First error line: `Error: Route "/": Next.js encountered uncached or runtime data during prerendering.` The error links to `https://nextjs.org/docs/messages/blocking-prerender-dynamic`, followed by `Error occurred prerendering page "/"`, `Export encountered an error on /page: /, exiting the build.` and `Next.js build worker exited with code: 1`. |
| Expected | Build succeeds. The route table shows `○ /` with `Revalidate 1h` and `Expire 1y` (static, which is what the control below produces). |

Observed on `16.4.0-canary.48` (Turbopack), trimmed:

```
▲ Next.js 16.4.0-canary.48 (Turbopack)
- Cache Components enabled
✓ Compiled successfully in 3.1s
  Generating static pages using 4 workers (0/3) ...
Error: Route "/": Next.js encountered uncached or runtime data during prerendering.
...
Learn more: https://nextjs.org/docs/messages/blocking-prerender-dynamic
    at body (<anonymous>)
    at html (<anonymous>)
...
Error occurred prerendering page "/". Read more: https://nextjs.org/docs/messages/prerender-error
Export encountered an error on /page: /, exiting the build.
⨯ Next.js build worker exited with code: 1 and signal: null
```

`16.3.6` prints the same lines. `next build --webpack` on canary prints the same error lines (webpack does not print the `at body`/`at html` frames).

### 2. `next dev`

```bash
rm -rf .next
npx next dev
```

In a second terminal, request the page twice and compare the two numbers:

```bash
curl -s http://localhost:3000/ | grep -o '<p id="[a-z]*">[^<]*</p>'
curl -s http://localhost:3000/ | grep -o '<p id="[a-z]*">[^<]*</p>'
```

| | What to look for |
| --- | --- |
| Current (canary) | The `first` and `second` values change on every request, so each request refetches the API. In the dev server log, the `application-code` time of the second `GET /` stays at network round-trip scale. Shortly after each `GET /` line, the terminal also prints `Error: Route "/": Next.js encountered uncached data during prerendering.`, pointing at the `fetch` call (`app/page.tsx:4:21`). In a browser, the dev overlay shows 1 issue, titled "Blocking Route". |
| Expected | Both values are the same on every request until the 1h revalidate (or `revalidateTag("shared")`). The second `GET /` hits the fetch cache, and its `application-code` time drops to a few ms. No error in the terminal or overlay. |

Observed on `16.4.0-canary.48` (Turbopack), trimmed:

```
req 1: <p id="first">0.5803781611531635</p> <p id="second">0.8049157565767228</p>
req 2: <p id="first">0.8195101744169244</p> <p id="second">0.9509479308231455</p>
req 3: <p id="first">0.8457942468890792</p> <p id="second">0.5257162271893466</p>

 GET / 200 in 831ms (next.js: 399ms, application-code: 431ms)
 GET / 200 in 284ms (next.js: 0.8ms, application-code: 283ms)
 GET / 200 in 233ms (next.js: 1.9ms, application-code: 231ms)
Error: Route "/": Next.js encountered uncached data during prerendering.
...
Learn more: https://nextjs.org/docs/messages/blocking-prerender-dynamic
    at getRandom (app/page.tsx:4:21)
    at Home (app/page.tsx:12:23)
```

The dev error is printed asynchronously, a moment after the `GET /` line it belongs to, so wait a second or two before reading the log. Note that the dev wording ("uncached data") differs from the build wording ("uncached or runtime data").

Use `curl` or a normal reload. A hard reload, or DevTools with "Disable cache" on, sends `cache-control: no-cache`, and the dev server then skips the fetch cache whether or not this bug is present.

### 3. Control: inline options (builds fine)

In `app/page.tsx`, replace `fetchOptions` in the `fetch` call with an inline object literal so that every call gets a fresh object:

```tsx
const res = await fetch(
  `https://next-data-api-endpoint.vercel.app/api/random?id=${id}`,
  { next: { revalidate: 3600, tags: ["shared"] } },
);
```

Then `rm -rf .next && npx next build`. The build succeeds:

```
Route (app)      Revalidate  Expire
┌ ○ /                    1h      1y
└ ○ /_not-found
```

In `next dev` the values stay the same across requests, the second and third `GET /` take `application-code: 16ms` / `14ms`, and no error is printed.

The only difference from step 1 is whether the same object is passed to both calls.

A second workaround, passing `{ ...fetchOptions }` instead of `fetchOptions`, also builds as `○ /  1h  1y`. Only the top-level `next` key is deleted, so a shallow copy per call is enough.

## Why `rm -rf .next`

`.next/cache/fetch-cache` persists across builds and dev sessions. A fetch-cache hit returns before the code that mutates the options object runs. So a cache warmed by an earlier successful run (the control, or a Next.js build with the fix) can hide the bug. Clear `.next` before every run.

## Files the commands add to this folder

Running the steps creates or changes files that are not part of the repro. Do not commit them if you publish this folder:

- `next build` adds `".next/dev/types/**/*.ts"` to `include` in `tsconfig.json`, and creates `next-env.d.ts` (already in `.gitignore`).
- `next dev` generates `AGENTS.md` on `16.4.0-canary.48`, and `AGENTS.md` plus `CLAUDE.md` on `16.3.6`. `.gitignore` does not cover them. `agentRules: false` in `next.config.ts` turns this off.
- `npm install` creates `package-lock.json`.

## Optional variants (not part of the minimal repro)

Both were run on `16.4.0-canary.48` with `cacheComponents` removed from `next.config.ts` and `rm -rf .next` before each build.

- **Plain options object, no `cacheComponents`.** The build succeeds (`○ /  1h  1y`). After both fetches, `fetchOptions` is `{}` (logged from the page during the build). In `.next/cache/fetch-cache/`, the `?id=first` entry has `tags: ["shared"]` and the `?id=second` entry has `tags: []`, so `revalidateTag("shared")` does not target the second fetch.
- **Frozen options object, no `cacheComponents`.** `app/fetch-options.ts` exports `Object.freeze({ next: Object.freeze({ revalidate: 3600, tags: ["shared"] }) })`.
  - `npx next build --webpack` fails prerendering `/` with `TypeError: Cannot delete property 'next' of #<Object>`.
  - `npx next build` (Turbopack) succeeds with no error. The frozen object keeps its `next`, and both fetch-cache entries have `tags: ["shared"]`. The page chunk bundles `next/dist/esm/server/lib/patch-fetch.js`, and the `delete` on the frozen object does not throw there. That behavior matches sloppy-mode `delete` semantics, which suggests the bundled module does not run in strict mode. This was not investigated further.

## Testing a Next.js build with the fix (optional)

The fix is on branch `fix/fetch-options-mutation` of the contributor's fork. `contributing/core/developing-using-local-app.md` in the Next.js repo describes how to point an app at a local monorepo build. For example, run `pnpm build-all` in the monorepo on that branch, then from the monorepo root run `pnpm next build <path-to-this-repro>`. The exact command shape for this repro has not been verified.
