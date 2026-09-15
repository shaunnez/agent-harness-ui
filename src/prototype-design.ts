export function canonicalClaudeDesignUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "http://localhost");
    const match = url.pathname.match(/^\/design\/(?:p\/)?([a-z0-9_-]{8,100})\/?$/i);
    if (url.protocol !== "https:" || url.hostname !== "claude.ai" || !match) return null;
    const projectId = match[1];
    if (!projectId) return null;
    return `https://claude.ai/design/p/${encodeURIComponent(projectId)}`;
  } catch {
    return null;
  }
}

export function claudePreviewImageUrl(taskId: string, variantId: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/designs/${encodeURIComponent(variantId)}/preview-image`;
}
