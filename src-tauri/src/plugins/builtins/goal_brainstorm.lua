--[[ [manifest]
id = "builtin-goal-brainstorm"
name = "Goal Brainstorm"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-00000000000d",
    name = "Goal Brainstorm",
    description = "AI-powered review of your goals with progress insights, suggestions, and energy-aware tips",
    icon = "lightbulb",
    category = "custom",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "brainstorm goals", "goal ideas", "reflect on goals", "goal review"
      }},
    },
    steps = {
      {
        type = "goalBrainstorm",
        notebookTarget = { type = "current" },
        titleTemplate = "{{date}} - Goal Brainstorm",
        lookbackDays = 7,
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
