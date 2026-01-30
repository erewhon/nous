import type { JupyterOutput } from "../../types/jupyter";
import type { JupyterOutputItem } from "../../utils/api";

interface OutputRendererProps {
  output: JupyterOutput;
  isDark: boolean;
}

export function OutputRenderer({ output, isDark }: OutputRendererProps) {
  if (output.output_type === "stream") {
    const text = Array.isArray(output.text) ? output.text.join("") : output.text;
    const isError = output.name === "stderr";

    return (
      <pre
        className="p-3 text-sm font-mono whitespace-pre-wrap"
        style={{
          backgroundColor: isError
            ? isDark
              ? "#3d1f1f"
              : "#fff0f0"
            : isDark
            ? "#1a1a1a"
            : "#fafafa",
          color: isError
            ? isDark
              ? "#ff8888"
              : "#cc0000"
            : isDark
            ? "#d4d4d4"
            : "#333",
          margin: 0,
        }}
      >
        {text}
      </pre>
    );
  }

  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data;

    // Check for image data
    if (data["image/png"]) {
      const imageData = Array.isArray(data["image/png"])
        ? data["image/png"].join("")
        : data["image/png"];
      return (
        <div className="p-3">
          <img
            src={`data:image/png;base64,${imageData}`}
            alt="Output"
            className="max-w-full"
          />
        </div>
      );
    }

    if (data["image/jpeg"]) {
      const imageData = Array.isArray(data["image/jpeg"])
        ? data["image/jpeg"].join("")
        : data["image/jpeg"];
      return (
        <div className="p-3">
          <img
            src={`data:image/jpeg;base64,${imageData}`}
            alt="Output"
            className="max-w-full"
          />
        </div>
      );
    }

    // Check for HTML
    if (data["text/html"]) {
      const html = Array.isArray(data["text/html"])
        ? data["text/html"].join("")
        : data["text/html"];
      return (
        <div
          className="p-3 overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    // Plain text fallback
    if (data["text/plain"]) {
      const rawText = data["text/plain"];
      const text = Array.isArray(rawText) ? rawText.join("") : String(rawText);
      return (
        <pre
          className="p-3 text-sm font-mono whitespace-pre-wrap"
          style={{
            backgroundColor: isDark ? "#1a1a1a" : "#fafafa",
            color: isDark ? "#d4d4d4" : "#333",
            margin: 0,
          }}
        >
          {text}
        </pre>
      );
    }

    return null;
  }

  if (output.output_type === "error") {
    return (
      <pre
        className="p-3 text-sm font-mono whitespace-pre-wrap"
        style={{
          backgroundColor: isDark ? "#3d1f1f" : "#fff0f0",
          color: isDark ? "#ff8888" : "#cc0000",
          margin: 0,
        }}
      >
        <strong>{output.ename}: </strong>
        {output.evalue}
        {"\n\n"}
        {output.traceback.join("\n").replace(/\x1b\[[0-9;]*m/g, "")}
      </pre>
    );
  }

  return null;
}

/**
 * Convert a JupyterOutputItem (camelCase API response) to a JupyterOutput (snake_case Jupyter format).
 */
export function apiOutputToJupyterOutput(item: JupyterOutputItem): JupyterOutput {
  switch (item.outputType) {
    case "stream":
      return {
        output_type: "stream",
        name: item.name || "stdout",
        text: item.text || "",
      };
    case "execute_result":
      return {
        output_type: "execute_result",
        execution_count: item.executionCount ?? null,
        data: item.data || {},
        metadata: item.metadata || {},
      };
    case "display_data":
      return {
        output_type: "display_data",
        data: item.data || {},
        metadata: item.metadata || {},
      };
    case "error":
      return {
        output_type: "error",
        ename: item.ename || "Error",
        evalue: item.evalue || "",
        traceback: item.traceback || [],
      };
  }
}
