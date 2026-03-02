/**
 * Custom flashcard block — replaces FlashcardTool.ts.
 * No inline content — uses props for front/back text.
 */
import { createReactBlockSpec } from "@blocknote/react";
import { useState, useCallback } from "react";

export const FlashcardBlock = createReactBlockSpec(
  {
    type: "flashcard",
    propSchema: {
      front: { default: "" },
      back: { default: "" },
      cardType: {
        default: "basic" as const,
        values: ["basic", "cloze", "reversible"] as const,
      },
      deckId: { default: "" },
      cardId: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const { front, back, cardType } = props.block.props;
      const [showBack, setShowBack] = useState(false);

      const updateProp = useCallback(
        (key: "front" | "back", value: string) => {
          props.editor.updateBlock(props.block, {
            props: { [key]: value },
          });
        },
        [props.editor, props.block],
      );

      const cycleType = useCallback(() => {
        const types = ["basic", "cloze", "reversible"] as const;
        const idx = types.indexOf(cardType as (typeof types)[number]);
        const next = types[(idx + 1) % types.length]!;
        props.editor.updateBlock(props.block, {
          props: { cardType: next },
        });
      }, [props.editor, props.block, cardType]);

      return (
        <div className="bn-flashcard" contentEditable={false}>
          <div className="bn-flashcard-header">
            <button
              className="bn-flashcard-type"
              onClick={cycleType}
              title="Click to change card type"
            >
              {cardType}
            </button>
            <button
              className="bn-flashcard-toggle"
              onClick={() => setShowBack(!showBack)}
            >
              {showBack ? "Hide answer" : "Show answer"}
            </button>
          </div>
          <div className="bn-flashcard-front">
            <label>Front</label>
            <div
              className="bn-flashcard-input"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) =>
                updateProp("front", e.currentTarget.textContent ?? "")
              }
            >
              {front}
            </div>
          </div>
          {showBack && (
            <div className="bn-flashcard-back">
              <label>Back</label>
              <div
                className="bn-flashcard-input"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) =>
                  updateProp("back", e.currentTarget.textContent ?? "")
                }
              >
                {back}
              </div>
            </div>
          )}
        </div>
      );
    },
  },
);
