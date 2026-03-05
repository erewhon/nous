--[[ [manifest]
id = "builtin-daily-goal-nudge"
name = "Daily Goal Nudge"
version = "1.0.0"
is_builtin = true
]]

function describe_action(input_json)
  return nous.json_encode({
    id = "00000000-0000-0000-0001-00000000000c",
    name = "Daily Goal Nudge",
    description = "Check your goals and send inbox reminders for incomplete ones with streak and energy context",
    icon = "bell",
    category = "dailyRoutines",
    triggers = {
      { type = "manual" },
      { type = "aiChat", keywords = {
        "nudge goals", "goal check", "check my goals", "am I on track"
      }},
      { type = "scheduled", schedule = {
        type = "daily", time = "16:00", skipWeekends = false
      }},
    },
    steps = {
      {
        type = "goalNudge",
        includeEnergyContext = true,
      },
    },
    enabled = true,
    isBuiltIn = true,
    createdAt = "2024-01-01T00:00:00Z",
    updatedAt = "2024-01-01T00:00:00Z",
  })
end
