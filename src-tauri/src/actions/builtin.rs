//! Built-in Actions
//!
//! Pre-configured actions for Agile Results methodology and common workflows.

use uuid::Uuid;

use crate::actions::models::{
    Action, ActionCategory, ActionStep, ActionTrigger, ActionVariable, NotebookTarget, PageSelector,
    Schedule, SummaryOutput, VariableType,
};

/// Create all built-in actions
pub fn get_builtin_actions() -> Vec<Action> {
    vec![
        create_daily_outcomes_action(),
        create_weekly_outcomes_action(),
        create_monthly_review_action(),
        create_daily_reflection_action(),
        create_weekly_review_action(),
        create_carry_forward_action(),
        create_weekly_outcomes_carry_forward_action(),
        create_carry_forward_daily_notes_action(),
        create_weekly_study_review_action(),
        create_exam_prep_workflow_action(),
        create_daily_learning_summary_action(),
    ]
}

/// Daily Outcomes action - creates a page for setting daily goals
fn create_daily_outcomes_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000001").unwrap();

    Action {
        id,
        name: "Daily Outcomes".to_string(),
        description: "Create a new page for today's three key outcomes using Agile Results methodology".to_string(),
        icon: Some("target".to_string()),
        category: ActionCategory::AgileResults,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "daily goals".to_string(),
                    "daily outcomes".to_string(),
                    "three outcomes".to_string(),
                    "today's goals".to_string(),
                    "start my day".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Daily {
                    time: "08:00".to_string(),
                    skip_weekends: false,
                },
            },
        ],
        steps: vec![ActionStep::CreatePageFromTemplate {
            template_id: "agile-results-daily".to_string(),
            notebook_target: NotebookTarget::Current,
            title_template: "{{dayOfWeek}}, {{date}} - Daily Outcomes".to_string(),
            folder_name: None,
            tags: vec!["daily-outcomes".to_string(), "agile-results".to_string()],
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![
            ActionVariable {
                name: "date".to_string(),
                description: "Today's date".to_string(),
                default_value: None,
                variable_type: VariableType::CurrentDateFormatted {
                    format: "%B %d, %Y".to_string(),
                },
            },
            ActionVariable {
                name: "dayOfWeek".to_string(),
                description: "Day of the week".to_string(),
                default_value: None,
                variable_type: VariableType::DayOfWeek,
            },
        ],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Weekly Outcomes action - creates a page for the week's goals
fn create_weekly_outcomes_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000002").unwrap();

    Action {
        id,
        name: "Weekly Outcomes".to_string(),
        description: "Create a page outlining the three key outcomes for this week".to_string(),
        icon: Some("calendar".to_string()),
        category: ActionCategory::AgileResults,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "weekly goals".to_string(),
                    "weekly outcomes".to_string(),
                    "week planning".to_string(),
                    "this week".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Weekly {
                    days: vec!["monday".to_string()],
                    time: "08:00".to_string(),
                },
            },
        ],
        steps: vec![ActionStep::CreatePageFromTemplate {
            template_id: "agile-results-weekly".to_string(),
            notebook_target: NotebookTarget::Current,
            title_template: "Week {{weekNumber}} - Weekly Outcomes".to_string(),
            folder_name: None,
            tags: vec!["weekly-outcomes".to_string(), "agile-results".to_string()],
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "weekNumber".to_string(),
            description: "ISO week number".to_string(),
            default_value: None,
            variable_type: VariableType::WeekNumber,
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Monthly Review action - creates a monthly goals and review page
fn create_monthly_review_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000003").unwrap();

    Action {
        id,
        name: "Monthly Outcomes".to_string(),
        description: "Create a page for the month's key outcomes and priorities".to_string(),
        icon: Some("calendar".to_string()),
        category: ActionCategory::AgileResults,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "monthly goals".to_string(),
                    "monthly outcomes".to_string(),
                    "month planning".to_string(),
                    "this month".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Monthly {
                    day_of_month: 1,
                    time: "08:00".to_string(),
                },
            },
        ],
        steps: vec![ActionStep::CreatePageFromTemplate {
            template_id: "agile-results-monthly".to_string(),
            notebook_target: NotebookTarget::Current,
            title_template: "{{monthName}} {{year}} - Monthly Outcomes".to_string(),
            folder_name: None,
            tags: vec!["monthly-outcomes".to_string(), "agile-results".to_string()],
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![
            ActionVariable {
                name: "monthName".to_string(),
                description: "Current month name".to_string(),
                default_value: None,
                variable_type: VariableType::MonthName,
            },
            ActionVariable {
                name: "year".to_string(),
                description: "Current year".to_string(),
                default_value: None,
                variable_type: VariableType::Year,
            },
        ],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Daily Reflection action - creates an end-of-day reflection page
fn create_daily_reflection_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000004").unwrap();

    Action {
        id,
        name: "Daily Reflection".to_string(),
        description: "Create a reflection page for end-of-day review of wins and learnings".to_string(),
        icon: Some("sun".to_string()),
        category: ActionCategory::DailyRoutines,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "daily reflection".to_string(),
                    "end of day".to_string(),
                    "review my day".to_string(),
                    "what went well".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Daily {
                    time: "17:00".to_string(),
                    skip_weekends: true,
                },
            },
        ],
        steps: vec![ActionStep::CreatePageFromTemplate {
            template_id: "daily-reflection".to_string(),
            notebook_target: NotebookTarget::Current,
            title_template: "{{date}} - Daily Reflection".to_string(),
            folder_name: None,
            tags: vec!["daily-reflection".to_string(), "review".to_string()],
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "date".to_string(),
            description: "Today's date".to_string(),
            default_value: None,
            variable_type: VariableType::CurrentDateFormatted {
                format: "%B %d, %Y".to_string(),
            },
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Weekly Review action - creates a Friday retrospective page
fn create_weekly_review_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000005").unwrap();

    Action {
        id,
        name: "Weekly Review".to_string(),
        description: "Create a Friday Review page for weekly retrospective".to_string(),
        icon: Some("calendar".to_string()),
        category: ActionCategory::WeeklyReviews,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "weekly review".to_string(),
                    "friday review".to_string(),
                    "week retrospective".to_string(),
                    "review the week".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Weekly {
                    days: vec!["friday".to_string()],
                    time: "16:00".to_string(),
                },
            },
        ],
        steps: vec![ActionStep::CreatePageFromTemplate {
            template_id: "weekly-review".to_string(),
            notebook_target: NotebookTarget::Current,
            title_template: "Week {{weekNumber}} - Friday Review".to_string(),
            folder_name: None,
            tags: vec!["weekly-review".to_string(), "agile-results".to_string()],
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "weekNumber".to_string(),
            description: "ISO week number".to_string(),
            default_value: None,
            variable_type: VariableType::WeekNumber,
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Carry Forward action - copies incomplete items from recent days to today
fn create_carry_forward_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000006").unwrap();

    Action {
        id,
        name: "Carry Forward".to_string(),
        description: "Copy incomplete checklist items from recent pages to today's page"
            .to_string(),
        icon: Some("arrow-right".to_string()),
        category: ActionCategory::DailyRoutines,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "carry forward".to_string(),
                    "incomplete items".to_string(),
                    "unfinished tasks".to_string(),
                    "move tasks".to_string(),
                    "yesterday's tasks".to_string(),
                ],
            },
        ],
        steps: vec![ActionStep::CarryForwardItems {
            source_selector: PageSelector {
                notebook: Some(NotebookTarget::Current),
                created_within_days: Some(7),
                ..Default::default()
            },
            destination: NotebookTarget::Current,
            title_template: "{{dayOfWeek}}, {{date}} - Daily Journal".to_string(),
            template_id: Some("daily-journal".to_string()),
            find_existing: Some(PageSelector {
                notebook: Some(NotebookTarget::Current),
                created_within_days: Some(0), // Today only
                ..Default::default()
            }),
            insert_after_section: Some("Today's Goals".to_string()),
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![
            ActionVariable {
                name: "date".to_string(),
                description: "Today's date".to_string(),
                default_value: None,
                variable_type: VariableType::CurrentDateFormatted {
                    format: "%B %d, %Y".to_string(),
                },
            },
            ActionVariable {
                name: "dayOfWeek".to_string(),
                description: "Day of the week".to_string(),
                default_value: None,
                variable_type: VariableType::DayOfWeek,
            },
        ],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Weekly Outcomes Carry Forward action - copies incomplete outcomes from last week to this week
fn create_weekly_outcomes_carry_forward_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000007").unwrap();

    Action {
        id,
        name: "Weekly Outcomes Carry Forward".to_string(),
        description: "Copy incomplete outcomes from last week's Weekly Outcomes page to this week"
            .to_string(),
        icon: Some("arrow-right".to_string()),
        category: ActionCategory::AgileResults,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "weekly carry forward".to_string(),
                    "carry over outcomes".to_string(),
                    "last week outcomes".to_string(),
                    "weekly outcomes carry".to_string(),
                ],
            },
        ],
        steps: vec![ActionStep::CarryForwardItems {
            source_selector: PageSelector {
                notebook: Some(NotebookTarget::Current),
                title_pattern: Some("*Weekly Outcomes*".to_string()),
                created_within_days: Some(14), // Look back 2 weeks
                ..Default::default()
            },
            destination: NotebookTarget::Current,
            title_template: "Week {{weekNumber}} - Weekly Outcomes".to_string(),
            template_id: Some("agile-results-weekly".to_string()),
            find_existing: Some(PageSelector {
                notebook: Some(NotebookTarget::Current),
                title_pattern: Some("*Week {{weekNumber}}*Weekly Outcomes*".to_string()),
                created_within_days: Some(7), // This week only
                ..Default::default()
            }),
            insert_after_section: Some("This Week's Outcomes".to_string()),
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "weekNumber".to_string(),
            description: "ISO week number".to_string(),
            default_value: None,
            variable_type: VariableType::WeekNumber,
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Carry Forward Daily Notes action - copies incomplete items from recent daily notes to today's
fn create_carry_forward_daily_notes_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000008").unwrap();

    Action {
        id,
        name: "Daily Note + Carry Forward".to_string(),
        description: "Create today's daily note and carry forward incomplete checklist items from recent daily notes"
            .to_string(),
        icon: Some("calendar-arrow-right".to_string()),
        category: ActionCategory::DailyRoutines,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "carry forward daily".to_string(),
                    "daily note carry".to_string(),
                    "yesterday daily note".to_string(),
                    "carry tasks from yesterday".to_string(),
                    "create daily note".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Daily {
                    time: "07:00".to_string(),
                    skip_weekends: false,
                },
            },
        ],
        steps: vec![ActionStep::CarryForwardItems {
            source_selector: PageSelector {
                notebook: Some(NotebookTarget::Current),
                is_daily_note: Some(true),
                daily_note_date: Some("recent:7".to_string()),
                ..Default::default()
            },
            destination: NotebookTarget::Current,
            title_template: "{{dayOfWeek}}, {{date}}".to_string(),
            template_id: Some("daily-journal".to_string()),
            find_existing: Some(PageSelector {
                notebook: Some(NotebookTarget::Current),
                is_daily_note: Some(true),
                daily_note_date: Some("today".to_string()),
                ..Default::default()
            }),
            insert_after_section: Some("Today's Goals".to_string()),
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![
            ActionVariable {
                name: "date".to_string(),
                description: "Today's date".to_string(),
                default_value: None,
                variable_type: VariableType::CurrentDateFormatted {
                    format: "%B %d, %Y".to_string(),
                },
            },
            ActionVariable {
                name: "dayOfWeek".to_string(),
                description: "Day of the week".to_string(),
                default_value: None,
                variable_type: VariableType::DayOfWeek,
            },
        ],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Weekly Study Review action - summarizes the week's notes and generates flashcards
fn create_weekly_study_review_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-000000000009").unwrap();

    Action {
        id,
        name: "Weekly Study Review".to_string(),
        description: "Summarize this week's study notes and generate review flashcards".to_string(),
        icon: Some("book-open".to_string()),
        category: ActionCategory::WeeklyReviews,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "weekly study review".to_string(),
                    "study review".to_string(),
                    "review study notes".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Weekly {
                    days: vec!["friday".to_string()],
                    time: "17:00".to_string(),
                },
            },
        ],
        steps: vec![
            ActionStep::AiSummarize {
                selector: PageSelector {
                    notebook: Some(NotebookTarget::Current),
                    created_within_days: Some(7),
                    ..Default::default()
                },
                output_target: SummaryOutput::NewPage {
                    notebook_target: NotebookTarget::Current,
                    title_template: "Week {{weekNumber}} - Study Review".to_string(),
                },
                custom_prompt: Some(
                    "Focus on key concepts learned this week, connections between topics, and areas that need further review."
                        .to_string(),
                ),
            },
            ActionStep::GenerateFlashcards {
                selector: PageSelector {
                    notebook: Some(NotebookTarget::Current),
                    created_within_days: Some(7),
                    ..Default::default()
                },
                deck_id: "weekly-review".to_string(),
                num_cards: Some(20),
                card_types: vec!["basic".to_string(), "cloze".to_string()],
            },
        ],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "weekNumber".to_string(),
            description: "ISO week number".to_string(),
            default_value: None,
            variable_type: VariableType::WeekNumber,
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Exam Prep Workflow action - generates study guide, flashcards, and practice questions
fn create_exam_prep_workflow_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-00000000000a").unwrap();

    Action {
        id,
        name: "Exam Prep Workflow".to_string(),
        description: "Generate a comprehensive study guide, flashcards, and practice questions for exam preparation".to_string(),
        icon: Some("graduation-cap".to_string()),
        category: ActionCategory::Organization,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "exam prep".to_string(),
                    "prepare for exam".to_string(),
                    "study for test".to_string(),
                    "test preparation".to_string(),
                ],
            },
        ],
        steps: vec![
            ActionStep::GenerateStudyGuide {
                selector: PageSelector {
                    notebook: Some(NotebookTarget::Current),
                    ..Default::default()
                },
                notebook_target: NotebookTarget::Current,
                title_template: "Exam Prep - Study Guide ({{date}})".to_string(),
                depth: Some("comprehensive".to_string()),
                focus_areas: Vec::new(),
            },
            ActionStep::GenerateFlashcards {
                selector: PageSelector {
                    notebook: Some(NotebookTarget::Current),
                    ..Default::default()
                },
                deck_id: "exam-prep".to_string(),
                num_cards: Some(30),
                card_types: vec![
                    "basic".to_string(),
                    "cloze".to_string(),
                    "reversible".to_string(),
                ],
            },
            ActionStep::GenerateFaq {
                selector: PageSelector {
                    notebook: Some(NotebookTarget::Current),
                    ..Default::default()
                },
                output_target: SummaryOutput::NewPage {
                    notebook_target: NotebookTarget::Current,
                    title_template: "Exam Prep - Practice Questions ({{date}})".to_string(),
                },
                num_questions: Some(15),
            },
        ],
        enabled: true,
        is_built_in: true,
        variables: vec![ActionVariable {
            name: "date".to_string(),
            description: "Today's date".to_string(),
            default_value: None,
            variable_type: VariableType::CurrentDateFormatted {
                format: "%B %d, %Y".to_string(),
            },
        }],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

/// Daily Learning Summary action - summarizes today's learning with concepts and follow-ups
fn create_daily_learning_summary_action() -> Action {
    let id = Uuid::parse_str("00000000-0000-0000-0001-00000000000b").unwrap();

    Action {
        id,
        name: "Daily Learning Summary".to_string(),
        description: "Create a summary of today's learning with key concepts, connections, and follow-up suggestions".to_string(),
        icon: Some("lightbulb".to_string()),
        category: ActionCategory::DailyRoutines,
        triggers: vec![
            ActionTrigger::Manual,
            ActionTrigger::AiChat {
                keywords: vec![
                    "daily learning summary".to_string(),
                    "what did I learn".to_string(),
                    "today's learning".to_string(),
                ],
            },
            ActionTrigger::Scheduled {
                schedule: Schedule::Daily {
                    time: "18:00".to_string(),
                    skip_weekends: false,
                },
            },
        ],
        steps: vec![ActionStep::AiSummarize {
            selector: PageSelector {
                notebook: Some(NotebookTarget::Current),
                created_within_days: Some(0),
                ..Default::default()
            },
            output_target: SummaryOutput::NewPage {
                notebook_target: NotebookTarget::Current,
                title_template: "{{date}} - Learning Summary".to_string(),
            },
            custom_prompt: Some(
                "Summarize the key concepts learned today, highlight connections between topics, and suggest follow-up areas to explore."
                    .to_string(),
            ),
        }],
        enabled: true,
        is_built_in: true,
        variables: vec![
            ActionVariable {
                name: "date".to_string(),
                description: "Today's date".to_string(),
                default_value: None,
                variable_type: VariableType::CurrentDateFormatted {
                    format: "%B %d, %Y".to_string(),
                },
            },
            ActionVariable {
                name: "dayOfWeek".to_string(),
                description: "Day of the week".to_string(),
                default_value: None,
                variable_type: VariableType::DayOfWeek,
            },
        ],
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        last_run: None,
        next_run: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_actions_created() {
        let actions = get_builtin_actions();
        assert_eq!(actions.len(), 11);
    }

    #[test]
    fn test_daily_outcomes_has_ai_trigger() {
        let action = create_daily_outcomes_action();
        let has_ai_trigger = action.triggers.iter().any(|t| matches!(t, ActionTrigger::AiChat { .. }));
        assert!(has_ai_trigger);
    }

    #[test]
    fn test_all_builtin_actions_marked_builtin() {
        let actions = get_builtin_actions();
        for action in actions {
            assert!(action.is_built_in, "Action {} should be marked as built-in", action.name);
        }
    }
}
