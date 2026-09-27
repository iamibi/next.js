export async function register() {
  // The span counter uses the Node.js OpenTelemetry SDK, so only load it in
  // the Node.js runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./span-counter')
  }
}
