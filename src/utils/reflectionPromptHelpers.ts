export type PromptCategory = "gratitude" | "learning" | "goals" | "review" | "free";

export const PROMPT_CATEGORIES: { value: PromptCategory; label: string }[] = [
  { value: "gratitude", label: "Gratitude" },
  { value: "learning", label: "Learning" },
  { value: "goals", label: "Goals" },
  { value: "review", label: "Review" },
  { value: "free", label: "Free" },
];

export function buildReflectionPrompt(
  category: PromptCategory,
  recentContent: string
): string {
  const categoryInstructions: Record<PromptCategory, string> = {
    gratitude:
      "Generate 3 gratitude-focused journaling prompts. Help the writer reflect on what they're thankful for, positive experiences, and things they appreciate.",
    learning:
      "Generate 3 learning-focused journaling prompts. Help the writer reflect on what they've learned, new insights, skills developed, or knowledge gained.",
    goals:
      "Generate 3 goal-focused journaling prompts. Help the writer reflect on their aspirations, progress toward goals, and planning for the future.",
    review:
      "Generate 3 review-focused journaling prompts. Help the writer reflect on their recent experiences, decisions, patterns, and areas for improvement.",
    free:
      "Generate 3 open-ended, creative journaling prompts. Encourage deep reflection, self-discovery, and exploratory writing.",
  };

  let prompt = categoryInstructions[category];
  prompt += "\n\nReturn ONLY the 3 prompts, one per line, numbered 1-3. Keep each prompt to 1-2 sentences.";

  if (recentContent) {
    prompt += `\n\nBase the prompts on the writer's recent journal entries for personalization:\n${recentContent.slice(0, 2000)}`;
  }

  return prompt;
}

export function parsePromptsResponse(response: string): string[] {
  const lines = response
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Remove numbering prefixes like "1.", "1)", "1:"
    .map((line) => line.replace(/^\d+[.):\-]\s*/, ""))
    .filter((line) => line.length > 10);

  return lines.slice(0, 3);
}

export const FALLBACK_PROMPTS: Record<PromptCategory, string[]> = {
  gratitude: [
    "What are three things that went well today, and why?",
    "Who is someone you're grateful to have in your life right now?",
    "What simple pleasure did you enjoy recently that you often take for granted?",
  ],
  learning: [
    "What's something new you learned this week that surprised you?",
    "What mistake taught you the most recently, and what did you take away from it?",
    "What skill or knowledge area do you want to explore further?",
  ],
  goals: [
    "What's one goal you've made progress on this week? What helped?",
    "If you could accomplish just one thing this week, what would make the biggest difference?",
    "What's a long-term goal you've been putting off, and what's one small step you could take today?",
  ],
  review: [
    "What patterns do you notice in how you've been spending your time lately?",
    "What's one thing you would do differently if you could redo this week?",
    "What gave you the most energy this week, and what drained it?",
  ],
  free: [
    "If you had no limitations, what would you create or build?",
    "Write about a moment recently when you felt most like yourself.",
    "What question has been on your mind lately that you haven't found an answer to?",
  ],
};
