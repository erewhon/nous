import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";

type FlashcardType = "basic" | "cloze" | "reversible";

interface FlashcardBlockData {
  front: string;
  back: string;
  cardType: FlashcardType;
  deckId?: string;
  cardId?: string;
}

interface FlashcardConfig {
  frontPlaceholder?: string;
  backPlaceholder?: string;
  onAddToDeck?: (
    front: string,
    back: string,
    cardType: FlashcardType,
    blockId: string
  ) => Promise<{ deckId: string; cardId: string } | null>;
}

const CARD_TYPE_CONFIG: Record<
  FlashcardType,
  { icon: string; label: string; description: string }
> = {
  basic: {
    icon: "📝",
    label: "Basic",
    description: "Simple question and answer",
  },
  cloze: {
    icon: "📋",
    label: "Cloze",
    description: "Fill in the blank",
  },
  reversible: {
    icon: "🔄",
    label: "Reversible",
    description: "Can be reviewed both ways",
  },
};

export class FlashcardTool implements BlockTool {
  private data: FlashcardBlockData;
  private config: FlashcardConfig;
  private blockId: string;
  private wrapper: HTMLDivElement | null = null;
  private frontEl: HTMLDivElement | null = null;
  private backEl: HTMLDivElement | null = null;
  private isFlipped = false;

  static get toolbox() {
    return {
      title: "Flashcard",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="12" x2="22" y2="12"/></svg>',
    };
  }

  static get enableLineBreaks() {
    return true;
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      front: {
        b: true,
        i: true,
        a: { href: true },
        code: true,
        br: true,
      },
      back: {
        b: true,
        i: true,
        a: { href: true },
        code: true,
        br: true,
      },
      cardType: false,
      deckId: false,
      cardId: false,
    };
  }

  constructor({
    data,
    config,
    block,
  }: BlockToolConstructorOptions<FlashcardBlockData, FlashcardConfig>) {
    this.config = config || {};
    this.blockId = block?.id || crypto.randomUUID();
    this.data = {
      front: data.front || "",
      back: data.back || "",
      cardType: data.cardType || "basic",
      deckId: data.deckId,
      cardId: data.cardId,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("flashcard-block");

    // Card container with flip effect
    const cardContainer = document.createElement("div");
    cardContainer.classList.add("flashcard-container");

    // Front side
    const frontSide = document.createElement("div");
    frontSide.classList.add("flashcard-side", "flashcard-front");

    const frontLabel = document.createElement("div");
    frontLabel.classList.add("flashcard-label");
    frontLabel.textContent = "Front";

    this.frontEl = document.createElement("div");
    this.frontEl.classList.add("flashcard-content");
    this.frontEl.contentEditable = "true";
    this.frontEl.innerHTML = this.data.front;
    this.frontEl.dataset.placeholder =
      this.config.frontPlaceholder || "Enter question...";

    this.frontEl.addEventListener("input", () => {
      this.data.front = this.frontEl!.innerHTML;
    });

    this.frontEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        this.backEl?.focus();
      }
    });

    frontSide.appendChild(frontLabel);
    frontSide.appendChild(this.frontEl);

    // Back side
    const backSide = document.createElement("div");
    backSide.classList.add("flashcard-side", "flashcard-back");

    const backLabel = document.createElement("div");
    backLabel.classList.add("flashcard-label");
    backLabel.textContent = "Back";

    this.backEl = document.createElement("div");
    this.backEl.classList.add("flashcard-content");
    this.backEl.contentEditable = "true";
    this.backEl.innerHTML = this.data.back;
    this.backEl.dataset.placeholder =
      this.config.backPlaceholder || "Enter answer...";

    this.backEl.addEventListener("input", () => {
      this.data.back = this.backEl!.innerHTML;
    });

    this.backEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        this.frontEl?.focus();
      }
    });

    backSide.appendChild(backLabel);
    backSide.appendChild(this.backEl);

    cardContainer.appendChild(frontSide);
    cardContainer.appendChild(backSide);

    // Toolbar
    const toolbar = this.createToolbar();

    this.wrapper.appendChild(cardContainer);
    this.wrapper.appendChild(toolbar);

    // Update synced state indicator
    this.updateSyncedState();

    return this.wrapper;
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.classList.add("flashcard-toolbar");

    // Type selector
    const typeSelector = document.createElement("div");
    typeSelector.classList.add("flashcard-type-selector");

    (Object.keys(CARD_TYPE_CONFIG) as FlashcardType[]).forEach((type) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.classList.add("flashcard-type-btn");
      if (type === this.data.cardType) {
        btn.classList.add("flashcard-type-btn--active");
      }
      btn.textContent = `${CARD_TYPE_CONFIG[type].icon} ${CARD_TYPE_CONFIG[type].label}`;
      btn.title = CARD_TYPE_CONFIG[type].description;

      btn.addEventListener("click", () => {
        this.setCardType(type);
        typeSelector.querySelectorAll(".flashcard-type-btn").forEach((b) => {
          b.classList.remove("flashcard-type-btn--active");
        });
        btn.classList.add("flashcard-type-btn--active");
      });

      typeSelector.appendChild(btn);
    });

    // Flip preview button
    const flipBtn = document.createElement("button");
    flipBtn.type = "button";
    flipBtn.classList.add("flashcard-flip-btn");
    flipBtn.innerHTML = '<span class="flip-icon">↩️</span> Preview Flip';
    flipBtn.addEventListener("click", () => {
      this.toggleFlip();
    });

    // Add to deck button (if callback provided)
    const addToDeckBtn = document.createElement("button");
    addToDeckBtn.type = "button";
    addToDeckBtn.classList.add("flashcard-add-deck-btn");

    if (this.data.cardId) {
      addToDeckBtn.innerHTML = "✓ In Deck";
      addToDeckBtn.classList.add("flashcard-add-deck-btn--synced");
    } else {
      addToDeckBtn.innerHTML = "+ Add to Deck";
    }

    addToDeckBtn.addEventListener("click", async () => {
      if (this.config.onAddToDeck && !this.data.cardId) {
        const result = await this.config.onAddToDeck(
          this.data.front,
          this.data.back,
          this.data.cardType,
          this.blockId
        );
        if (result) {
          this.data.deckId = result.deckId;
          this.data.cardId = result.cardId;
          this.updateSyncedState();
          addToDeckBtn.innerHTML = "✓ In Deck";
          addToDeckBtn.classList.add("flashcard-add-deck-btn--synced");
        }
      }
    });

    toolbar.appendChild(typeSelector);
    toolbar.appendChild(flipBtn);
    toolbar.appendChild(addToDeckBtn);

    return toolbar;
  }

  private setCardType(type: FlashcardType): void {
    this.data.cardType = type;
  }

  private toggleFlip(): void {
    this.isFlipped = !this.isFlipped;
    if (this.wrapper) {
      if (this.isFlipped) {
        this.wrapper.classList.add("flashcard-block--flipped");
      } else {
        this.wrapper.classList.remove("flashcard-block--flipped");
      }
    }
  }

  private updateSyncedState(): void {
    if (this.wrapper) {
      if (this.data.cardId) {
        this.wrapper.classList.add("flashcard-block--synced");
      } else {
        this.wrapper.classList.remove("flashcard-block--synced");
      }
    }
  }

  save(): FlashcardBlockData {
    return {
      front: this.frontEl?.innerHTML || "",
      back: this.backEl?.innerHTML || "",
      cardType: this.data.cardType,
      deckId: this.data.deckId,
      cardId: this.data.cardId,
    };
  }

  validate(savedData: FlashcardBlockData): boolean {
    // At least front or back should have content
    return savedData.front.trim() !== "" || savedData.back.trim() !== "";
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");

    // Card type settings
    const typeSection = document.createElement("div");
    typeSection.classList.add("flashcard-settings-section");

    const typeLabel = document.createElement("div");
    typeLabel.classList.add("flashcard-settings-label");
    typeLabel.textContent = "Card Type";
    typeSection.appendChild(typeLabel);

    (Object.keys(CARD_TYPE_CONFIG) as FlashcardType[]).forEach((type) => {
      const item = document.createElement("div");
      item.classList.add("cdx-settings-button");
      if (type === this.data.cardType) {
        item.classList.add("cdx-settings-button--active");
      }
      item.innerHTML = `${CARD_TYPE_CONFIG[type].icon} ${CARD_TYPE_CONFIG[type].label}`;
      item.title = CARD_TYPE_CONFIG[type].description;
      item.addEventListener("click", () => {
        this.setCardType(type);
        typeSection.querySelectorAll(".cdx-settings-button").forEach((btn) => {
          btn.classList.remove("cdx-settings-button--active");
        });
        item.classList.add("cdx-settings-button--active");
      });
      typeSection.appendChild(item);
    });

    wrapper.appendChild(typeSection);

    return wrapper;
  }
}
