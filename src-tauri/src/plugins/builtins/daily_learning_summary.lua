--[[ [manifest]
id = "builtin-daily-learning-summary"
name = "Daily Learning Summary"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-00000000000b",
    name = "Daily Learning Summary",
    description = "Create a summary of today's learning with key concepts, connections, and follow-up suggestions",
    icon = "lightbulb",
    category = "dailyRoutines",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "daily learning summary", "what did I learn", "today's learning"
      }},
      { type = "scheduled", schedule = {
        type = "daily", time = "18:00", skipWeekends = false
      }},
    },
    steps = {
      {
        type = "aiSummarize",
        selector = {
          notebook = { type = "current" },
          createdWithinDays = 0,
        },
        outputTarget = {
          type = "newPage",
          notebookTarget = { type = "current" },
          titleTemplate = "{{date}} - Learning Summary",
        },
        customPrompt = "Summarize the key concepts learned today, highlight connections between topics, and suggest follow-up areas to explore.",
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
      {
        name = "dayOfWeek",
        description = "Day of the week",
        variableType = "dayOfWeek",
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
