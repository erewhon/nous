// Coarse-pointer detection (mobile spec decision C, 2026-07-06): vim mode
// and other keyboard/hover-dependent affordances turn off when the PRIMARY
// pointer is touch. `pointer: coarse` — not viewport width — so a tablet
// with a trackpad/mouse keeps them while a phone doesn't.

export function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
