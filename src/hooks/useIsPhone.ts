import { useSyncExternalStore } from "react";

// Phone breakpoint for the mobile shell (see Forge "Spec: Nous Mobile Web
// Experience"): below this the app renders single-pane + drawer + bottom
// nav. Tablets and up keep the desktop layout (decision E, 2026-07-06).
export const PHONE_MEDIA_QUERY = "(max-width: 767px)";

function subscribe(callback: () => void): () => void {
  const mq = window.matchMedia(PHONE_MEDIA_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
