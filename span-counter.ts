// Counts Next.js' own OpenTelemetry spans per request and logs one line per
// page request. It does not export anything anywhere.
//
// Span names come from packages/next/src/server/lib/trace/constants.ts. Both
// are only emitted when NEXT_OTEL_VERBOSE=1 is set.
//
// - AppRender.renderToReadableStream wraps every React DOM server (Fizz)
//   render: the page's own HTML render, plus every render that
//   getServerInsertedHTML() does to turn useServerInsertedHTML() results into
//   an HTML string.
// - AppRender.renderToNodeFizzStream wraps only the page's own HTML render on
//   the Node.js runtime. It is counted as a sanity check (expect 1).
//
// A dynamic page request renders the page's HTML once, so
// server_inserted_html_renders = fizz_renders - 1.

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node'

const FIZZ_RENDER = 'AppRender.renderToReadableStream'
const PAGE_RENDER = 'AppRender.renderToNodeFizzStream'
const HANDLE_REQUEST = 'BaseServer.handleRequest'

type RequestCounts = {
  spanId: string
  target: string
  fizzRenders: number
  pageRenders: number
}

// Keyed by trace ID. Each incoming request is one trace.
const requests = new Map<string, RequestCounts>()

const spanCounter: SpanProcessor = {
  onStart(span: Span) {
    if (span.attributes['next.span_type'] !== HANDLE_REQUEST) return
    const { traceId, spanId } = span.spanContext()
    if (requests.has(traceId)) return
    requests.set(traceId, {
      spanId,
      target: String(span.attributes['http.target'] ?? span.name),
      fizzRenders: 0,
      pageRenders: 0,
    })
  },

  onEnd(span: ReadableSpan) {
    const type = span.attributes['next.span_type']
    const { traceId, spanId } = span.spanContext()
    const request = requests.get(traceId)

    if (type === FIZZ_RENDER || type === PAGE_RENDER) {
      if (!request) {
        console.log(
          `[span-count] ${type} ended outside of a tracked request (trace ${traceId})`
        )
        return
      }
      if (type === FIZZ_RENDER) request.fizzRenders++
      else request.pageRenders++
      return
    }

    // The request span ends after the response has been fully streamed.
    if (type === HANDLE_REQUEST && request && request.spanId === spanId) {
      requests.delete(traceId)
      // Skip requests that did not render a page (e.g. static files).
      if (request.fizzRenders === 0) return
      console.log(
        `[span-count] target=${request.target}` +
          ` fizz_renders=${request.fizzRenders}` +
          ` page_renders=${request.pageRenders}` +
          ` server_inserted_html_renders=${request.fizzRenders - 1}`
      )
    }
  },

  async forceFlush() {},
  async shutdown() {},
}

new NodeTracerProvider({ spanProcessors: [spanCounter] }).register()
