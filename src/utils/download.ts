// Browser download fallback for flows that use a native save dialog on
// desktop (platform/dialog save() returns null in browsers). Triggers a
// standard browser download via a Blob object URL.

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/plain;charset=utf-8"
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Strip characters that are invalid in filenames on common platforms. */
export function safeFilename(name: string, fallback = "untitled"): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, "-").trim();
  return cleaned || fallback;
}
