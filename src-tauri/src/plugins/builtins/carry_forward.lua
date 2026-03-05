--[[ [manifest]
id = "builtin-carry-forward"
name = "Carry Forward"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000006",
    name = "Carry Forward",
    description = "Copy incomplete checklist items from recent pages to today's page",
    icon = "arrow-right",
    category = "dailyRoutines",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "carry forward", "incomplete items", "unfinished tasks",
        "move tasks", "yesterday's tasks"
      }},
    },
    steps = {
      {
        type = "carryForwardItems",
        sourceSelector = {
          notebook = { type = "current" },
          createdWithinDays = 7,
        },
        destination = { type = "current" },
        titleTemplate = "{{dayOfWeek}}, {{date}} - Daily Journal",
        templateId = "daily-journal",
        findExisting = {
          notebook = { type = "current" },
          createdWithinDays = 0,
        },
        insertAfterSection = "Today's Goals",
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
