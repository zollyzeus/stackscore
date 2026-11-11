export function extractFromTranscript(
  transcript: Record<string, unknown>,
  stage: string,
  field: string
): string {
  const entries = (transcript[stage] ?? []) as Array<Record<string, unknown>>;
  return entries
    .filter((e) => !field || e[field] !== undefined)
    .map((e) => (field ? String(e[field] ?? "") : JSON.stringify(e)))
    .join("\n");
}
