/** A failure's message for the operator, or a plain fallback. Its own module so the research
 *  console can use it without bundling the harness's refresh coordinator. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed.";
}
