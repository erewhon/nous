--[[ [manifest]
id = "builtin-weekly-carry-forward"
name = "Weekly Outcomes Carry Forward"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000007",
    name = "Weekly Outcomes Carry Forward",
    description = "Copy incomplete outcomes from last week's Weekly Outcomes page to this week",
    icon = "arrow-right",
    category = "agileResults",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "weekly carry forward", "carry over outcomes",
        "last week outcomes", "weekly outcomes carry"
      }},
    },
    steps = {
      {
        type = "carryForwardItems",
        sourceSelector = {
          notebook = { type = "current" },
          titlePattern = "*Weekly Outcomes*",
          createdWithinDays = 14,
        },
        destination = { type = "current" },
        titleTemplate = "Week {{weekNumber}} - Weekly Outcomes",
        templateId = "agile-results-weekly",
        findExisting = {
          notebook = { type = "current" },
          titlePattern = "*Week {{weekNumber}}*Weekly Outcomes*",
          createdWithinDays = 7,
        },
        insertAfterSection = "This Week's Outcomes",
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
