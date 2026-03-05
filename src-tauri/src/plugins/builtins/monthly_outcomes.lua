--[[ [manifest]
id = "builtin-monthly-outcomes"
name = "Monthly Outcomes"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-000000000003",
    name = "Monthly Outcomes",
    description = "Create a page for the month's key outcomes and priorities",
    icon = "calendar",
    category = "agileResults",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "monthly goals", "monthly outcomes", "month planning", "this month"
      }},
      { type = "scheduled", schedule = {
        type = "monthly", dayOfMonth = 1, time = "08:00"
      }},
    },
    steps = {
      {
        type = "createPageFromTemplate",
        templateId = "agile-results-monthly",
        notebookTarget = { type = "current" },
        titleTemplate = "{{monthName}} {{year}} - Monthly Outcomes",
        tags = { "monthly-outcomes", "agile-results" },
      },
    },
    enabled = true,
    isBuiltIn = true,
    variables = {
      {
        name = "monthName",
        description = "Current month name",
        variableType = "monthName",
      },
      {
        name = "year",
        description = "Current year",
        variableType = "year",
      },
    },
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
