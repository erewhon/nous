--[[ [manifest]
id = "builtin-weekly-study-review"
name = "Weekly Study Review"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000009",
    name = "Weekly Study Review",
    description = "Summarize this week's study notes and generate review flashcards",
    icon = "book-open",
    category = "weeklyReviews",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "weekly study review", "study review", "review study notes"
      }},
      { type = "scheduled", schedule = {
        type = "weekly", days = { "friday" }, time = "17:00"
      }},
    },
    steps = {
      {
        type = "aiSummarize",
        selector = {
          notebook = { type = "current" },
          createdWithinDays = 7,
        },
        outputTarget = {
          type = "newPage",
          notebookTarget = { type = "current" },
          titleTemplate = "Week {{weekNumber}} - Study Review",
        },
        customPrompt = "Focus on key concepts learned this week, connections between topics, and areas that need further review.",
      },
      {
        type = "generateFlashcards",
        selector = {
          notebook = { type = "current" },
          createdWithinDays = 7,
        },
        deckId = "weekly-review",
        numCards = 20,
        cardTypes = { "basic", "cloze" },
      },
    },
    enabled = true,
    isBuiltIn = true,
    variables = {
      {
        name = "weekNumber",
        description = "ISO week number",
        variableType = "weekNumber",
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
