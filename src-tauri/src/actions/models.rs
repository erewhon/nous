use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===== Schedule Types =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Schedule {
    /// Daily at specific time
    #[serde(rename_all = "camelCase")]
    Daily {
        /// Time in HH:MM format
        time: String,
        /// Skip weekends
        #[serde(default)]
        skip_weekends: bool,
    },
    /// Weekly on specific days
    Weekly {
        /// Days of the week
        days: Vec<String>,
        /// Time in HH:MM format
        time: String,
    },
    /// Monthly on specific day
    #[serde(rename_all = "camelCase")]
    Monthly {
        /// Day of month (1-31)
        day_of_month: u8,
        /// Time in HH:MM format
        time: String,
    },
}

impl Schedule {
    /// Parse time string to NaiveTime
    pub fn parse_time(&self) -> Option<NaiveTime> {
        let time_str = match self {
            Schedule::Daily { time, .. } => time,
            Schedule::Weekly { time, .. } => time,
            Schedule::Monthly { time, .. } => time,
        };
        NaiveTime::parse_from_str(time_str, "%H:%M").ok()
    }
}

// ===== Trigger Types =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActionTrigger {
    /// Manual trigger via UI or command palette
    Manual,
    /// AI chat invocation (e.g., "run my daily goals action")
    AiChat {
        /// Keywords/phrases that trigger this action
        keywords: Vec<String>,
    },
    /// Scheduled trigger
    Scheduled {
        schedule: Schedule,
    },
}

// ===== Notebook Target =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NotebookTarget {
    /// Current notebook
    Current,
    /// Specific notebook by ID
    ById { id: String },
    /// Specific notebook by name (creates if not exists)
    ByName { name: String },
}

// ===== Page Selector =====

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageSelector {
    /// Notebook to search in
    pub notebook: Option<NotebookTarget>,
    /// Title pattern (supports wildcards with *)
    pub title_pattern: Option<String>,
    /// Tags that must be present
    #[serde(default)]
    pub with_tags: Vec<String>,
    /// Tags that must NOT be present
    #[serde(default)]
    pub without_tags: Vec<String>,
    /// Created within N days
    pub created_within_days: Option<u32>,
    /// Updated within N days
    pub updated_within_days: Option<u32>,
    /// Only archived pages
    #[serde(default)]
    pub archived_only: bool,
    /// Folder name
    pub in_folder: Option<String>,
    /// Filter by template ID the page was created from
    pub from_template: Option<String>,
}

// ===== Page Destination =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDestination {
    pub notebook: NotebookTarget,
    pub folder_name: Option<String>,
}

// ===== Summary Output =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SummaryOutput {
    /// New page with summary
    #[serde(rename_all = "camelCase")]
    NewPage {
        notebook_target: NotebookTarget,
        title_template: String,
    },
    /// Prepend to existing page
    #[serde(rename_all = "camelCase")]
    PrependToPage { page_selector: PageSelector },
    /// Return as result (for chaining)
    Result,
}

// ===== Step Condition =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StepCondition {
    /// Check if pages exist matching selector
    PagesExist { selector: PageSelector },
    /// Check if it's a specific day of week
    DayOfWeek { days: Vec<String> },
    /// Check if variable matches
    VariableEquals { name: String, value: String },
    /// Check if variable is not empty
    VariableNotEmpty { name: String },
}

// ===== Step Types =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ActionStep {
    /// Create a page from a template
    #[serde(rename_all = "camelCase")]
    CreatePageFromTemplate {
        template_id: String,
        notebook_target: NotebookTarget,
        /// Title with variable substitution (e.g., "Daily Goals - {{date}}")
        title_template: String,
        /// Optional folder to place the page in
        folder_name: Option<String>,
        /// Tags to apply
        #[serde(default)]
        tags: Vec<String>,
    },
    /// Create a new notebook
    #[serde(rename_all = "camelCase")]
    CreateNotebook {
        name: String,
        #[serde(default)]
        notebook_type: Option<String>,
    },
    /// Create folder in a notebook
    #[serde(rename_all = "camelCase")]
    CreateFolder {
        notebook_target: NotebookTarget,
        name: String,
        parent_folder_name: Option<String>,
    },
    /// Move pages matching criteria
    MovePages {
        source: PageSelector,
        destination: PageDestination,
    },
    /// Archive pages matching criteria
    ArchivePages { selector: PageSelector },
    /// Add/remove tags from pages
    #[serde(rename_all = "camelCase")]
    ManageTags {
        selector: PageSelector,
        #[serde(default)]
        add_tags: Vec<String>,
        #[serde(default)]
        remove_tags: Vec<String>,
    },
    /// Search and process results
    #[serde(rename_all = "camelCase")]
    SearchAndProcess {
        query: String,
        process_steps: Vec<ActionStep>,
        limit: Option<usize>,
    },
    /// AI summarization of pages
    #[serde(rename_all = "camelCase")]
    AiSummarize {
        selector: PageSelector,
        /// Where to place the summary
        output_target: SummaryOutput,
        /// Custom prompt for summarization
        custom_prompt: Option<String>,
    },
    /// Carry forward incomplete checklist items
    #[serde(rename_all = "camelCase")]
    CarryForwardItems {
        source_selector: PageSelector,
        destination: NotebookTarget,
        title_template: String,
        template_id: Option<String>,
        /// Find existing destination page instead of always creating new
        #[serde(default)]
        find_existing: Option<PageSelector>,
        /// Insert carried items after this section header
        #[serde(default)]
        insert_after_section: Option<String>,
    },
    /// Wait/delay step (for chaining)
    Delay { seconds: u64 },
    /// Conditional execution
    #[serde(rename_all = "camelCase")]
    Conditional {
        condition: StepCondition,
        then_steps: Vec<ActionStep>,
        #[serde(default)]
        else_steps: Vec<ActionStep>,
    },
    /// Set a variable for later use
    SetVariable { name: String, value: String },
}

// ===== Variable Types =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum VariableType {
    /// User provides value
    UserInput,
    /// Current date (format: YYYY-MM-DD)
    CurrentDate,
    /// Current date with custom format
    CurrentDateFormatted { format: String },
    /// Day of week name
    DayOfWeek,
    /// Week number
    WeekNumber,
    /// Month name
    MonthName,
    /// Year
    Year,
    /// Current notebook name
    CurrentNotebook,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionVariable {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub default_value: Option<String>,
    /// Built-in variable type for auto-population
    pub variable_type: VariableType,
}

// ===== Action Category =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ActionCategory {
    AgileResults,
    DailyRoutines,
    WeeklyReviews,
    Organization,
    Custom,
}

impl Default for ActionCategory {
    fn default() -> Self {
        ActionCategory::Custom
    }
}

// ===== Action Definition =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub category: ActionCategory,
    pub triggers: Vec<ActionTrigger>,
    pub steps: Vec<ActionStep>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub is_built_in: bool,
    /// Variables that can be substituted
    #[serde(default)]
    pub variables: Vec<ActionVariable>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Last successful execution
    #[serde(default)]
    pub last_run: Option<DateTime<Utc>>,
    /// Next scheduled run (if applicable)
    #[serde(default)]
    pub next_run: Option<DateTime<Utc>>,
}

fn default_true() -> bool {
    true
}

impl Action {
    pub fn new(name: String, description: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            description,
            icon: None,
            category: ActionCategory::Custom,
            triggers: vec![ActionTrigger::Manual],
            steps: Vec::new(),
            enabled: true,
            is_built_in: false,
            variables: Vec::new(),
            created_at: now,
            updated_at: now,
            last_run: None,
            next_run: None,
        }
    }

    /// Check if this action has any scheduled triggers
    pub fn has_schedule(&self) -> bool {
        self.triggers
            .iter()
            .any(|t| matches!(t, ActionTrigger::Scheduled { .. }))
    }

    /// Get scheduled triggers
    pub fn get_schedules(&self) -> Vec<&Schedule> {
        self.triggers
            .iter()
            .filter_map(|t| {
                if let ActionTrigger::Scheduled { schedule } = t {
                    Some(schedule)
                } else {
                    None
                }
            })
            .collect()
    }

    /// Check if this action matches AI keywords
    pub fn matches_keywords(&self, input: &str) -> bool {
        let input_lower = input.to_lowercase();
        self.triggers.iter().any(|t| {
            if let ActionTrigger::AiChat { keywords } = t {
                keywords
                    .iter()
                    .any(|kw| input_lower.contains(&kw.to_lowercase()))
            } else {
                false
            }
        })
    }
}

// ===== Execution Results =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionExecutionResult {
    pub action_id: Uuid,
    pub action_name: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub success: bool,
    pub steps_completed: usize,
    pub steps_total: usize,
    #[serde(default)]
    pub created_pages: Vec<String>,
    #[serde(default)]
    pub created_notebooks: Vec<String>,
    #[serde(default)]
    pub modified_pages: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

impl ActionExecutionResult {
    pub fn new(action_id: Uuid, action_name: String, steps_total: usize) -> Self {
        Self {
            action_id,
            action_name,
            started_at: Utc::now(),
            completed_at: Utc::now(),
            success: false,
            steps_completed: 0,
            steps_total,
            created_pages: Vec::new(),
            created_notebooks: Vec::new(),
            modified_pages: Vec::new(),
            errors: Vec::new(),
        }
    }

    pub fn complete(&mut self, success: bool) {
        self.completed_at = Utc::now();
        self.success = success;
    }
}

// ===== Scheduled Action Info =====

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledActionInfo {
    pub action_id: Uuid,
    pub action_name: String,
    pub next_run: DateTime<Utc>,
    pub schedule: Schedule,
    pub enabled: bool,
}

// ===== Action Update =====

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub category: Option<ActionCategory>,
    pub triggers: Option<Vec<ActionTrigger>>,
    pub steps: Option<Vec<ActionStep>>,
    pub enabled: Option<bool>,
    pub variables: Option<Vec<ActionVariable>>,
}
