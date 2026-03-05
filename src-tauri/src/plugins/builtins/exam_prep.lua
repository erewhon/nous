--[[ [manifest]
id = "builtin-exam-prep"
name = "Exam Prep Workflow"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-00000000000a",
    name = "Exam Prep Workflow",
    description = "Generate a comprehensive study guide, flashcards, and practice questions for exam preparation",
    icon = "graduation-cap",
    category = "organization",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "exam prep", "prepare for exam", "study for test", "test preparation"
      }},
    },
    steps = {
      {
        type = "generateStudyGuide",
        selector = {
          notebook = { type = "current" },
        },
        notebookTarget = { type = "current" },
        titleTemplate = "Exam Prep - Study Guide ({{date}})",
        depth = "comprehensive",
      },
      {
        type = "generateFlashcards",
        selector = {
          notebook = { type = "current" },
        },
        deckId = "exam-prep",
        numCards = 30,
        cardTypes = { "basic", "cloze", "reversible" },
      },
      {
        type = "generateFaq",
        selector = {
          notebook = { type = "current" },
        },
        outputTarget = {
          type = "newPage",
          notebookTarget = { type = "current" },
          titleTemplate = "Exam Prep - Practice Questions ({{date}})",
        },
        numQuestions = 15,
      },
    },
    enabled = true,
    isBuiltIn = true,
    variables = {
      {
        name = "date",
        description = "Today's date",
        variableType = { currentDateFormatted = { format = "%B %d, %Y" } },
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
