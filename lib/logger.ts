export function logError(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(JSON.stringify({
    severity: "ERROR",
    message: `${context}: ${message}`,
    stack,
    serviceContext: { service: "stackscore" },
  }));
}
