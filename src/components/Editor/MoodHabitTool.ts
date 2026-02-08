import type {
  BlockTool,
  BlockToolConstructorOptions,
} from "@editorjs/editorjs";

interface HabitEntry {
  name: string;
  checked: boolean;
}

interface MoodHabitBlockData {
  mood: number; // 0-5 (0 = unset)
  habits: HabitEntry[];
  date: string; // "YYYY-MM-DD"
}

const MOOD_EMOJIS = [
  { value: 1, emoji: "\u{1F614}", label: "Awful" }, // 😔
  { value: 2, emoji: "\u{1F615}", label: "Bad" }, // 😕
  { value: 3, emoji: "\u{1F610}", label: "Okay" }, // 😐
  { value: 4, emoji: "\u{1F642}", label: "Good" }, // 🙂
  { value: 5, emoji: "\u{1F60A}", label: "Great" }, // 😊
];

export class MoodHabitTool implements BlockTool {
  private data: MoodHabitBlockData;
  private wrapper: HTMLDivElement | null = null;

  static get toolbox() {
    return {
      title: "Mood & Habits",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get sanitize() {
    return {
      mood: false,
      habits: false,
      date: false,
    };
  }

  constructor({ data }: BlockToolConstructorOptions<MoodHabitBlockData>) {
    const today = new Date().toISOString().split("T")[0];

    // Get default habits from the store if available
    let defaultHabits: HabitEntry[] = [
      { name: "Exercise", checked: false },
      { name: "Reading", checked: false },
      { name: "Meditation", checked: false },
    ];

    // Try to get habits from the mood habit store
    try {
      // Dynamic import would be ideal but we're in vanilla JS context
      // so we read from localStorage directly
      const stored = localStorage.getItem("katt-mood-habits");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.state?.habitList && Array.isArray(parsed.state.habitList)) {
          defaultHabits = parsed.state.habitList.map((name: string) => ({
            name,
            checked: false,
          }));
        }
      }
    } catch {
      // ignore
    }

    this.data = {
      mood: data.mood || 0,
      habits:
        data.habits && data.habits.length > 0 ? data.habits : defaultHabits,
      date: data.date || today,
    };
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("mood-habit-block");

    // Date label
    const dateLabel = document.createElement("div");
    dateLabel.classList.add("mood-habit-date");
    dateLabel.textContent = this.formatDate(this.data.date);
    this.wrapper.appendChild(dateLabel);

    // Mood section
    const moodSection = document.createElement("div");
    moodSection.classList.add("mood-habit-mood-section");

    const moodLabel = document.createElement("div");
    moodLabel.classList.add("mood-habit-label");
    moodLabel.textContent = "Mood";
    moodSection.appendChild(moodLabel);

    const moodRow = document.createElement("div");
    moodRow.classList.add("mood-emoji-row");

    for (const item of MOOD_EMOJIS) {
      const btn = document.createElement("button");
      btn.classList.add("mood-emoji-btn");
      if (this.data.mood === item.value) {
        btn.classList.add("selected");
      }
      btn.textContent = item.emoji;
      btn.title = item.label;
      btn.type = "button";

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.data.mood = this.data.mood === item.value ? 0 : item.value;
        // Update UI
        moodRow
          .querySelectorAll(".mood-emoji-btn")
          .forEach((b) => b.classList.remove("selected"));
        if (this.data.mood === item.value) {
          btn.classList.add("selected");
        }
      });

      moodRow.appendChild(btn);
    }
    moodSection.appendChild(moodRow);
    this.wrapper.appendChild(moodSection);

    // Habits section
    const habitsSection = document.createElement("div");
    habitsSection.classList.add("mood-habit-habits-section");

    const habitsLabel = document.createElement("div");
    habitsLabel.classList.add("mood-habit-label");
    habitsLabel.textContent = "Habits";
    habitsSection.appendChild(habitsLabel);

    for (let i = 0; i < this.data.habits.length; i++) {
      const habit = this.data.habits[i];
      const row = document.createElement("label");
      row.classList.add("habit-row");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = habit.checked;
      checkbox.classList.add("habit-checkbox");
      checkbox.addEventListener("change", () => {
        this.data.habits[i].checked = checkbox.checked;
      });

      const label = document.createElement("span");
      label.classList.add("habit-name");
      label.textContent = habit.name;

      row.appendChild(checkbox);
      row.appendChild(label);
      habitsSection.appendChild(row);
    }

    this.wrapper.appendChild(habitsSection);
    return this.wrapper;
  }

  save(): MoodHabitBlockData {
    return {
      mood: this.data.mood,
      habits: this.data.habits.map((h) => ({ name: h.name, checked: h.checked })),
      date: this.data.date,
    };
  }

  private formatDate(dateStr: string): string {
    try {
      const [year, month, day] = dateStr.split("-");
      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
    } catch {
      return dateStr;
    }
  }
}
