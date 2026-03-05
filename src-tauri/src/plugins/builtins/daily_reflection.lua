--[[ [manifest]
id = "builtin-daily-reflection"
name = "Daily Reflection"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000004",
    name = "Daily Reflection",
    description = "Create a reflection page for end-of-day review of wins and learnings",
    icon = "sun",
    category = "dailyRoutines",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "daily reflection", "end of day", "review my day", "what went well"
      }},
      { type = "scheduled", schedule = {
        type = "daily", time = "17:00", skipWeekends = true
      }},
    },
    steps = {
      {
        type = "createPageFromTemplate",
        templateId = "daily-reflection",
        notebookTarget = { type = "current" },
        titleTemplate = "{{date}} - Daily Reflection",
        tags = { "daily-reflection", "review" },
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
