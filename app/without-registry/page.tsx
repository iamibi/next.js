import {
  getBoundaryCount,
  StreamingContent,
  type SearchParams,
} from '../streaming-content'

// Control: the same streaming page without a style registry.
// Reading searchParams makes the page render on every request.
export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return <StreamingContent boundaries={await getBoundaryCount(searchParams)} />
}
