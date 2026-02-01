import type { EditorData } from "../../types/page";

export function createDefaultCoverContent(notebookName: string): EditorData {
  return {
    time: Date.now(),
    version: "2.28.0",
    blocks: [
      {
        id: crypto.randomUUID(),
        type: "header",
        data: {
          text: notebookName,
          level: 1,
        },
      },
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        data: {
          text: "A collection of thoughts, ideas, and knowledge.",
        },
      },
      {
        id: crypto.randomUUID(),
        type: "delimiter",
        data: {},
      },
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        data: {
          text: "<i>Click below to enter your notebook</i>",
        },
      },
    ],
  };
}
