import type { NumberFormat } from "../../types/database";

export function formatNumber(value: number, format?: NumberFormat): string {
  if (!format) return String(value);

  const { style = "plain", decimals, thousandsSeparator, currencySymbol } = format;

  let num = value;

  if (style === "percent") {
    // Heuristic: if value is between -1 and 1 (exclusive of larger), treat as ratio
    if (Math.abs(num) <= 1) {
      num = num * 100;
    }
  }

  let formatted: string;
  if (decimals != null) {
    formatted = num.toFixed(decimals);
  } else if (style === "currency") {
    formatted = num.toFixed(2);
  } else {
    formatted = String(num);
  }

  if (thousandsSeparator || style === "currency") {
    const parts = formatted.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    formatted = parts.join(".");
  }

  if (style === "currency") {
    const symbol = currencySymbol || "$";
    return `${symbol}${formatted}`;
  }

  if (style === "percent") {
    return `${formatted}%`;
  }

  return formatted;
}
