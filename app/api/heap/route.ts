// Reports the server's heap after a full garbage collection. `gc` is only
// available when the server runs with `NODE_OPTIONS=--expose-gc`.
export const dynamic = "force-dynamic";

export function GET() {
  const gc = (globalThis as unknown as { gc?: () => void }).gc;
  gc?.();
  gc?.();

  return Response.json({
    heapUsed: process.memoryUsage().heapUsed,
    gcExposed: typeof gc === "function",
  });
}
