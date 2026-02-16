/** Adjust a hex color's brightness by a given amount (-255 to 255). */
export function adjustColor(color: string, amount: number): string {
  // If it's a CSS variable, return as-is
  if (color.startsWith("var(")) {
    return color;
  }

  // Handle hex colors
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
    const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  return color;
}
