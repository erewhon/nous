/** Extensions that can be imported natively via importFileAsPage */
export const NATIVE_IMPORT_EXTENSIONS = [
  "md",
  "markdown",
  "pdf",
  "ipynb",
  "epub",
  "ics",
  "ical",
  "canvas",
] as const;

/** Extensions that require conversion via convertDocument before import */
export const CONVERTIBLE_EXTENSIONS = [
  "docx",
  "doc",
  "pptx",
  "ppt",
  "xlsx",
  "xls",
  "html",
  "htm",
  "csv",
  "json",
  "xml",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "tiff",
  "svg",
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "flac",
  "zip",
  "txt",
  "rtf",
] as const;

/** All supported file extensions */
export const ALL_SUPPORTED_EXTENSIONS = [
  ...NATIVE_IMPORT_EXTENSIONS,
  ...CONVERTIBLE_EXTENSIONS,
] as const;

export type ImportAction = "native" | "convert";

export interface FileClassification {
  extension: string;
  action: ImportAction;
  supported: boolean;
}

/** Classify a file path by its extension */
export function classifyFile(path: string): FileClassification {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";

  if ((NATIVE_IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    return { extension: ext, action: "native", supported: true };
  }
  if ((CONVERTIBLE_EXTENSIONS as readonly string[]).includes(ext)) {
    return { extension: ext, action: "convert", supported: true };
  }
  return { extension: ext, action: "native", supported: false };
}

/** Human-readable label for a file extension */
export function getFileTypeLabel(ext: string): string {
  switch (ext.toLowerCase()) {
    case "md":
    case "markdown":
      return "Markdown";
    case "pdf":
      return "PDF";
    case "ipynb":
      return "Jupyter Notebook";
    case "epub":
      return "EPUB";
    case "ics":
    case "ical":
      return "Calendar";
    case "canvas":
      return "Canvas";
    case "docx":
    case "doc":
      return "Word Document";
    case "pptx":
    case "ppt":
      return "PowerPoint";
    case "xlsx":
    case "xls":
      return "Excel Spreadsheet";
    case "html":
    case "htm":
      return "HTML";
    case "csv":
      return "CSV";
    case "json":
      return "JSON";
    case "xml":
      return "XML";
    case "txt":
      return "Text File";
    case "rtf":
      return "Rich Text";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "bmp":
    case "tiff":
    case "svg":
      return "Image";
    case "wav":
    case "mp3":
    case "m4a":
    case "ogg":
    case "flac":
      return "Audio";
    case "zip":
      return "ZIP Archive";
    default:
      return "File";
  }
}
