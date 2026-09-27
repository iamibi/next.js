import { Suspense } from 'react'

export type SearchParams = Promise<{
  [key: string]: string | string[] | undefined
}>

// `?boundaries=N` sets how many Suspense boundaries the page streams (1-50).
export async function getBoundaryCount(searchParams: SearchParams) {
  const { boundaries } = await searchParams
  const count = Number(Array.isArray(boundaries) ? boundaries[0] : boundaries)
  return Number.isInteger(count) && count > 0 ? Math.min(count, 50) : 5
}

async function Delayed({ ms }: { ms: number }) {
  await new Promise((resolve) => setTimeout(resolve, ms))
  return <p>Resolved after {ms}ms</p>
}

// Each boundary resolves 100ms after the previous one, so each is streamed in
// its own chunk.
export function StreamingContent({ boundaries }: { boundaries: number }) {
  return (
    <main>
      <h1>{boundaries} streamed Suspense boundaries</h1>
      {Array.from({ length: boundaries }, (_, index) => {
        const ms = (index + 1) * 100
        return (
          <Suspense key={ms} fallback={<p>Loading ({ms}ms)...</p>}>
            <Delayed ms={ms} />
          </Suspense>
        )
      })}
    </main>
  )
}
