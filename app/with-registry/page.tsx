import {
  getBoundaryCount,
  StreamingContent,
  type SearchParams,
} from '../streaming-content'

// Same page as /without-registry, but wrapped in a style registry by
// ./layout.tsx. Reading searchParams makes the page render on every request.
export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return <StreamingContent boundaries={await getBoundaryCount(searchParams)} />
}
