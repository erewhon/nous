// Backlink excerpt extraction for the Study right rail: given a source page's
// blocks and the target page title, find the sentence around the wiki-link and
// split it into before / link / after so the link can render highlighted
// (mockup design/direction-a-editor.html, .backlink .bx — "…the strongest
// version of this is *the extended mind* thesis, which…").

export interface BacklinkExcerpt {
  before: string;
  link: string;
  after: string;
}

interface ExcerptBlock {
  data?: Record<string, unknown>;
}

/** Max characters kept on each side of the link. */
const SIDE = 70;

const BOUNDARY = /[.!?]/;

function clampBefore(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trimStart();
  if (!s) return "";
  const window = s.length > SIDE ? s.slice(-SIDE) : s;
  // A cut at a sentence boundary reads as a clean fragment — no ellipsis.
  for (let i = window.length - 1; i >= 0; i--) {
    if (BOUNDARY.test(window[i]!)) {
      return window.slice(i + 1).trimStart();
    }
  }
  if (window.length === s.length) return window;
  // Truncated mid-sentence — drop a leading half-word and mark the cut.
  let cut = window;
  const sp = cut.indexOf(" ");
  if (sp >= 0 && sp < cut.length - 1) cut = cut.slice(sp + 1);
  return "…" + cut;
}

function clampAfter(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trimEnd();
  if (!s) return "";
  const window = s.length > SIDE ? s.slice(0, SIDE) : s;
  // Prefer ending at the first sentence boundary in the window.
  for (let i = 0; i < window.length; i++) {
    if (BOUNDARY.test(window[i]!)) {
      return window.slice(0, i + 1);
    }
  }
  if (window.length === s.length) return window;
  // Truncated mid-sentence — drop a trailing half-word and mark the cut.
  let cut = window;
  const sp = cut.lastIndexOf(" ");
  if (sp > 0) cut = cut.slice(0, sp);
  return cut + "…";
}

/**
 * Find the first wiki-link to `targetTitle` in `blocks` and return the
 * surrounding sentence split around the link text. Returns null when no
 * block links to the target (e.g. the link lives in a non-text block).
 */
export function extractBacklinkExcerpt(
  blocks: ExcerptBlock[] | undefined,
  targetTitle: string
): BacklinkExcerpt | null {
  if (!blocks || typeof document === "undefined") return null;
  const wanted = targetTitle.trim().toLowerCase();
  if (!wanted) return null;

  for (const block of blocks) {
    const html = block?.data?.text;
    if (typeof html !== "string" || !html.toLowerCase().includes("wiki-link")) {
      continue;
    }
    const div = document.createElement("div");
    div.innerHTML = html;
    const match = Array.from(div.querySelectorAll("wiki-link")).find(
      (el) =>
        (el.getAttribute("data-page-title") ?? "").trim().toLowerCase() ===
          wanted || (el.textContent ?? "").trim().toLowerCase() === wanted
    );
    if (!match) continue;

    let before = "";
    let link = "";
    let after = "";
    let seenLink = false;
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const t = node.textContent ?? "";
      if (match.contains(node)) {
        seenLink = true;
        link += t;
      } else if (!seenLink) {
        before += t;
      } else {
        after += t;
      }
    }
    if (!link.trim()) continue;

    return {
      before: clampBefore(before),
      link: link.replace(/\s+/g, " ").trim(),
      after: clampAfter(after),
    };
  }

  return null;
}
