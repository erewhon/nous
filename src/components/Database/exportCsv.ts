import type { PropertyDef, DatabaseRow } from "../../types/database";

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportDatabaseAsCsv(
  properties: PropertyDef[],
  rows: DatabaseRow[],
  filename: string,
  pages?: Array<{ id: string; title: string }>
): void {
  // Header row
  const header = properties.map((p) => escapeCsvField(p.name)).join(",");

  // Data rows
  const dataRows = rows.map((row) => {
    return properties
      .map((prop) => {
        const val = row.cells[prop.id];

        if (val == null) return "";

        switch (prop.type) {
          case "select": {
            const opt = prop.options?.find((o) => o.id === val);
            return escapeCsvField(opt?.label ?? String(val));
          }
          case "multiSelect": {
            if (!Array.isArray(val)) return escapeCsvField(String(val));
            const labels = val
              .map((id) => prop.options?.find((o) => o.id === id)?.label ?? id)
              .join(", ");
            return escapeCsvField(labels);
          }
          case "checkbox":
            return val === true ? "true" : "false";
          case "number":
            return String(val);
          case "pageLink": {
            if (typeof val === "string") {
              const page = pages?.find((p) => p.id === val);
              return escapeCsvField(page?.title ?? val);
            }
            return "";
          }
          default:
            return escapeCsvField(String(val));
        }
      })
      .join(",");
  });

  const csv = [header, ...dataRows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename || "database"}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
