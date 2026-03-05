--[[ [manifest]
id = "builtin-daily-outcomes"
name = "Daily Outcomes"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000001",
    name = "Daily Outcomes",
    description = "Create a new page for today's three key outcomes using Agile Results methodology",
    icon = "target",
    category = "agileResults",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "daily goals", "daily outcomes", "three outcomes",
        "today's goals", "start my day"
      }},
      { type = "scheduled", schedule = {
        type = "daily", time = "08:00", skipWeekends = false
      }},
    },
    steps = {
      {
        type = "createPageFromTemplate",
        templateId = "agile-results-daily",
        notebookTarget = { type = "current" },
        titleTemplate = "{{dayOfWeek}}, {{date}} - Daily Outcomes",
        tags = { "daily-outcomes", "agile-results" },
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
