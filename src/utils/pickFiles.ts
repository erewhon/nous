// Browser file-picker fallback for flows that use the native open dialog
// on desktop (platform/dialog open() returns null in browsers). Creates a
// transient <input type="file"> and resolves with the chosen File objects
// (empty array if the user cancels).

export function pickFiles(options?: {
  accept?: string;
  multiple?: boolean;
}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options?.accept) input.accept = options.accept;
    if (options?.multiple) input.multiple = true;
    input.style.display = "none";

    const cleanup = () => {
      input.remove();
      window.removeEventListener("focus", onFocus);
    };
    // Cancel detection: when the dialog closes without a change event the
    // window regains focus — give the change event a beat to fire first.
    const onFocus = () => {
      setTimeout(() => {
        cleanup();
        resolve([]);
      }, 300);
    };

    input.onchange = () => {
      window.removeEventListener("focus", onFocus);
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    };

    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
