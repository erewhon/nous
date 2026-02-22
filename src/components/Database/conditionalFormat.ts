import type { PropertyDef, CellValue, ConditionalFormatStyle } from "../../types/database";
import { applyFilter } from "./DatabaseTable";

/**
 * Evaluate conditional format rules for a property against a cell value.
 * Returns the style of the first matching rule, or undefined if none match.
 */
export function evaluateConditionalFormat(
  prop: PropertyDef,
  cellValue: CellValue
): ConditionalFormatStyle | undefined {
  const rules = prop.conditionalFormats;
  if (!rules || rules.length === 0) return undefined;

  for (const rule of rules) {
    if (applyFilter(cellValue, rule.operator, rule.value, prop)) {
      return rule.style;
    }
  }
  return undefined;
}

/**
 * Convert a ConditionalFormatStyle to React.CSSProperties.
 */
export function conditionalStyleToCSS(
  style: ConditionalFormatStyle | undefined
): React.CSSProperties | undefined {
  if (!style) return undefined;
  const css: React.CSSProperties = {};
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style.textColor) css.color = style.textColor;
  return Object.keys(css).length > 0 ? css : undefined;
}
