//! Python bridge module for AI operations via PyO3.

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PythonError {
    #[error("Python error: {0}")]
    Python(#[from] PyErr),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Python module not found: {0}")]
    ModuleNotFound(String),

    #[error("Type conversion error: {0}")]
    TypeConversion(String),
}

pub type Result<T> = std::result::Result<T, PythonError>;

/// Chat message structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Response from AI chat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub tokens_used: Option<i64>,
    pub finish_reason: Option<String>,
}

/// Page context for AI operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContext {
    pub page_id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub notebook_name: Option<String>,
}

/// Input for batch page summarization
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSummaryInput {
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
}

/// Result from batch page summarization
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagesSummaryResult {
    pub summary: String,
    pub key_points: Vec<String>,
    pub action_items: Vec<String>,
    pub themes: Vec<String>,
    pub pages_count: i64,
    pub model: String,
    pub tokens_used: Option<i64>,
}

/// AI provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIConfig {
    pub provider_type: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            provider_type: "openai".to_string(),
            api_key: None,
            model: None,
            temperature: Some(0.7),
            max_tokens: Some(4096),
        }
    }
}

// ===== Web Research Types =====

/// Search result from Tavily
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub content: String,
    pub score: f64,
    pub published_date: Option<String>,
}

/// Search response from Tavily
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub results: Vec<SearchResult>,
    pub answer: Option<String>,
    pub follow_up_questions: Vec<String>,
}

/// Scraped content from URL
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedContent {
    pub url: String,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub word_count: i64,
}

/// Source reference in research summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub title: String,
    pub url: String,
}

/// Research summary from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSummary {
    pub summary: String,
    pub key_points: Vec<String>,
    pub sources: Vec<SourceRef>,
    pub suggested_tags: Vec<String>,
}

/// Result from document conversion (markitdown)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentConversionResult {
    pub content: String,
    pub source_path: String,
    pub source_type: String,
    pub title: Option<String>,
    pub word_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Page info for related pages suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
}

/// Related page suggestion from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedPageSuggestion {
    pub id: String,
    pub title: String,
    pub reason: String,
}

/// Notebook info for tool use context
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookInfo {
    pub id: String,
    pub name: String,
}

/// AI action from tool use
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIAction {
    pub tool: String,
    pub arguments: serde_json::Value,
    pub tool_call_id: String,
}

/// Response from AI chat with tool use
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponseWithActions {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub tokens_used: Option<i64>,
    pub finish_reason: Option<String>,
    pub actions: Vec<AIAction>,
    pub thinking: Option<String>,
}

/// Streaming event from AI chat
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    #[serde(rename = "chunk")]
    Chunk { content: String },
    #[serde(rename = "thinking")]
    Thinking { content: String },
    #[serde(rename = "action")]
    Action {
        tool: String,
        arguments: serde_json::Value,
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
    },
    #[serde(rename = "done")]
    Done {
        model: String,
        #[serde(rename = "tokensUsed")]
        tokens_used: i64,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

/// Result from browser automation task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTaskResult {
    pub success: bool,
    pub content: String,
    pub screenshot: Option<String>,
    pub structured_data: Option<serde_json::Value>,
    pub error: Option<String>,
}

// ===== Video Transcription Types =====

/// Word-level timestamp in transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptWord {
    pub word: String,
    pub start: f64,
    pub end: f64,
    pub probability: f64,
}

/// Segment of transcription with word timestamps
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: i64,
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub words: Vec<TranscriptWord>,
}

/// Result from video transcription
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub video_path: String,
    pub audio_path: Option<String>,
    pub language: String,
    pub language_probability: f64,
    pub duration: f64,
    pub segments: Vec<TranscriptSegment>,
    pub word_count: i64,
    pub transcription_time: f64,
}

// ===== Jupyter Execution Types =====

/// Result from executing a Jupyter notebook code cell
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JupyterCellOutput {
    /// Whether execution succeeded without errors
    pub success: bool,
    /// Cell outputs in Jupyter format (stream, execute_result, display_data, error)
    pub outputs: serde_json::Value,
    /// Execution count for the cell
    pub execution_count: Option<usize>,
}

/// Information about the Python execution environment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvironmentInfo {
    /// Whether Python execution is available
    pub available: bool,
    /// Python version string
    pub python_version: String,
    /// List of available packages
    pub packages: Vec<String>,
}

// ===== MCP (Model Context Protocol) Types =====

/// Configuration for a single MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: i64,
}

fn default_true() -> bool {
    true
}

fn default_timeout() -> i64 {
    30
}

// ===== Study Tools Types =====

/// Page content for study tools generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPageContent {
    pub page_id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Key concept in study guide
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyConcept {
    pub term: String,
    pub definition: String,
}

/// Section in study guide
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyGuideSection {
    pub heading: String,
    pub content: String,
    #[serde(default)]
    pub key_points: Vec<String>,
}

/// Practice question with answer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PracticeQuestion {
    pub question: String,
    pub answer: String,
}

/// Study guide generated from content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyGuide {
    pub title: String,
    #[serde(default)]
    pub learning_objectives: Vec<String>,
    #[serde(default)]
    pub key_concepts: Vec<KeyConcept>,
    #[serde(default)]
    pub sections: Vec<StudyGuideSection>,
    #[serde(default)]
    pub practice_questions: Vec<PracticeQuestion>,
    #[serde(default)]
    pub summary: String,
}

/// Options for study guide generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyGuideOptions {
    #[serde(default = "default_depth")]
    pub depth: String, // "brief", "standard", "comprehensive"
    #[serde(default)]
    pub focus_areas: Vec<String>,
    #[serde(default = "default_num_questions")]
    pub num_practice_questions: i32,
}

fn default_depth() -> String {
    "standard".to_string()
}

fn default_num_questions() -> i32 {
    5
}

/// FAQ item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FAQItem {
    pub question: String,
    pub answer: String,
    pub source_page_id: Option<String>,
}

/// FAQ collection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FAQ {
    #[serde(default)]
    pub questions: Vec<FAQItem>,
}

/// Generated flashcard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedFlashcard {
    pub front: String,
    pub back: String,
    #[serde(default = "default_card_type")]
    pub card_type: String, // "basic", "cloze", "reversible"
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_card_type() -> String {
    "basic".to_string()
}

/// Result of flashcard generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashcardGenerationResult {
    #[serde(default)]
    pub cards: Vec<GeneratedFlashcard>,
    #[serde(default)]
    pub source_page_ids: Vec<String>,
}

/// Action item in briefing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub description: String,
    pub owner: Option<String>,
    pub deadline: Option<String>,
    pub priority: Option<String>, // "low", "medium", "high"
}

/// Briefing document
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefingDocument {
    pub title: String,
    pub executive_summary: String,
    #[serde(default)]
    pub key_findings: Vec<String>,
    #[serde(default)]
    pub recommendations: Vec<String>,
    #[serde(default)]
    pub action_items: Vec<ActionItem>,
    #[serde(default)]
    pub detailed_sections: Vec<StudyGuideSection>,
}

/// Timeline event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub id: String,
    pub date: String,
    pub title: String,
    pub description: String,
    pub source_page_id: String,
    pub category: Option<String>,
}

/// Timeline of events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    #[serde(default)]
    pub events: Vec<TimelineEvent>,
    pub date_range_start: Option<String>,
    pub date_range_end: Option<String>,
}

/// Concept node in concept graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConceptNode {
    pub id: String,
    pub label: String,
    #[serde(default = "default_node_type")]
    pub node_type: String, // "concept", "example", "definition"
    pub description: Option<String>,
}

fn default_node_type() -> String {
    "concept".to_string()
}

/// Link between concepts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptLink {
    pub source: String,
    pub target: String,
    pub relationship: String,
}

/// Concept graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptGraph {
    #[serde(default)]
    pub nodes: Vec<ConceptNode>,
    #[serde(default)]
    pub links: Vec<ConceptLink>,
}

/// RAG chunk with source information for citations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RAGChunk {
    pub chunk_id: String,
    pub page_id: String,
    pub notebook_id: String,
    pub title: String,
    pub content: String,
    pub score: f32,
}

/// A citation reference in a response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub id: i32,
    pub page_id: String,
    pub page_title: String,
    pub excerpt: String,
    pub relevance_score: f32,
}

/// Response with inline citations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitedResponse {
    pub content: String,
    #[serde(default)]
    pub citations: Vec<Citation>,
}

/// Configuration for all MCP servers in a library
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MCPServersConfig {
    #[serde(default)]
    pub servers: Vec<MCPServerConfig>,
}

/// Tool definition from an MCP server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPTool {
    pub server_name: String,
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

/// Result from calling an MCP tool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MCPToolResult {
    pub server_name: String,
    pub tool_name: String,
    pub success: bool,
    pub content: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Configure sys.path for the given nous-py directory.
/// Handles both dev mode (venv at nous-py/.venv) and bundled release mode
/// (PYTHONHOME set, site-packages inside the bundle).
#[allow(deprecated)]
fn configure_python_path(py: Python<'_>, nous_py_path: &std::path::Path) -> Result<()> {
    let sys = py.import("sys")?;
    let path = sys.getattr("path")?;
    let path_list: Bound<'_, PyList> = path.downcast_into().map_err(|e| {
        PythonError::TypeConversion(format!("Failed to convert sys.path to list: {}", e))
    })?;

    // Add nous-py source directory
    let nous_py_str = nous_py_path.to_string_lossy().to_string();
    let already_added = path_list.iter().any(|p| {
        p.extract::<String>().ok() == Some(nous_py_str.clone())
    });

    if !already_added {
        path_list.insert(0, nous_py_str.clone())?;
    }

    // When PYTHONHOME is set (bundled mode), site-packages are already
    // under $PYTHONHOME/lib/pythonX.Y/site-packages/ and accessible via
    // the normal import machinery. We only need the nous-py source dir.
    if std::env::var("PYTHONHOME").is_ok() {
        return Ok(());
    }

    // Dev mode: add venv site-packages for dependencies (pydantic, httpx, etc.)
    let venv_lib = format!("{}/.venv/lib", nous_py_str);
    let mut site_packages = String::new();

    // Look for any pythonX.Y directory in .venv/lib
    if let Ok(entries) = std::fs::read_dir(&venv_lib) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("python") {
                let candidate = format!("{}/{}/site-packages", venv_lib, name);
                if std::path::Path::new(&candidate).exists() {
                    site_packages = candidate;
                    break;
                }
            }
        }
    }

    // Fallback to current Python version
    if site_packages.is_empty() {
        let version_info = sys.getattr("version_info")?;
        let major: i32 = version_info.getattr("major")?.extract()?;
        let minor: i32 = version_info.getattr("minor")?.extract()?;
        site_packages = format!(
            "{}/.venv/lib/python{}.{}/site-packages",
            nous_py_str, major, minor
        );
    }

    let site_already_added = path_list.iter().any(|p| {
        p.extract::<String>().ok() == Some(site_packages.clone())
    });

    if !site_already_added {
        path_list.insert(0, site_packages)?;
    }

    Ok(())
}

/// Python AI bridge for calling Python functions
pub struct PythonAI {
    nous_py_path: PathBuf,
}

impl PythonAI {
    /// Create a new PythonAI instance
    pub fn new(nous_py_path: PathBuf) -> Self {
        Self { nous_py_path }
    }

    /// Initialize Python path to include nous-py and its venv/bundled site-packages.
    fn setup_python_path(&self, py: Python<'_>) -> Result<()> {
        configure_python_path(py, &self.nous_py_path)
    }

    /// Send a chat request to the AI provider
    pub fn chat(&self, messages: Vec<ChatMessage>, config: AIConfig) -> Result<ChatResponse> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let chat_fn = chat_module.getattr("chat_sync")?;

            // Convert messages to Python list of dicts
            let py_messages = PyList::empty(py);
            for msg in messages {
                let dict = PyDict::new(py);
                dict.set_item("role", msg.role)?;
                dict.set_item("content", msg.content)?;
                py_messages.append(dict)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("messages", py_messages)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                kwargs.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                kwargs.set_item("max_tokens", max_tokens)?;
            }

            let result = chat_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(ChatResponse {
                content: result_dict
                    .get("content")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                model: result_dict
                    .get("model")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                provider: result_dict
                    .get("provider")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                tokens_used: result_dict
                    .get("tokens_used")
                    .and_then(|v| v.extract::<i64>(py).ok()),
                finish_reason: result_dict
                    .get("finish_reason")
                    .and_then(|v| v.extract::<String>(py).ok()),
            })
        })
    }

    /// Chat with page context
    pub fn chat_with_context(
        &self,
        user_message: String,
        page_context: Option<PageContext>,
        conversation_history: Option<Vec<ChatMessage>>,
        config: AIConfig,
    ) -> Result<ChatResponse> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let chat_fn = chat_module.getattr("chat_with_context_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("user_message", user_message)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                kwargs.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                kwargs.set_item("max_tokens", max_tokens)?;
            }

            // Add page context if provided
            if let Some(ctx) = page_context {
                let ctx_dict = PyDict::new(py);
                ctx_dict.set_item("page_id", ctx.page_id)?;
                ctx_dict.set_item("title", ctx.title)?;
                ctx_dict.set_item("content", ctx.content)?;
                ctx_dict.set_item("tags", ctx.tags)?;
                if let Some(notebook_name) = ctx.notebook_name {
                    ctx_dict.set_item("notebook_name", notebook_name)?;
                }
                kwargs.set_item("page_context", ctx_dict)?;
            }

            // Add conversation history if provided
            if let Some(history) = conversation_history {
                let py_history = PyList::empty(py);
                for msg in history {
                    let dict = PyDict::new(py);
                    dict.set_item("role", msg.role)?;
                    dict.set_item("content", msg.content)?;
                    py_history.append(dict)?;
                }
                kwargs.set_item("conversation_history", py_history)?;
            }

            let result = chat_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(ChatResponse {
                content: result_dict
                    .get("content")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                model: result_dict
                    .get("model")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                provider: result_dict
                    .get("provider")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                tokens_used: result_dict
                    .get("tokens_used")
                    .and_then(|v| v.extract::<i64>(py).ok()),
                finish_reason: result_dict
                    .get("finish_reason")
                    .and_then(|v| v.extract::<String>(py).ok()),
            })
        })
    }

    /// Chat with tools for creating notebooks/pages
    pub fn chat_with_tools(
        &self,
        user_message: String,
        page_context: Option<PageContext>,
        conversation_history: Option<Vec<ChatMessage>>,
        available_notebooks: Option<Vec<NotebookInfo>>,
        current_notebook_id: Option<String>,
        config: AIConfig,
    ) -> Result<ChatResponseWithActions> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let chat_fn = chat_module.getattr("chat_with_tools_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("user_message", user_message)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                kwargs.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                kwargs.set_item("max_tokens", max_tokens)?;
            }

            // Add page context if provided
            if let Some(ctx) = page_context {
                let ctx_dict = PyDict::new(py);
                ctx_dict.set_item("page_id", ctx.page_id)?;
                ctx_dict.set_item("title", ctx.title)?;
                ctx_dict.set_item("content", ctx.content)?;
                ctx_dict.set_item("tags", ctx.tags)?;
                if let Some(notebook_name) = ctx.notebook_name {
                    ctx_dict.set_item("notebook_name", notebook_name)?;
                }
                kwargs.set_item("page_context", ctx_dict)?;
            }

            // Add conversation history if provided
            if let Some(history) = conversation_history {
                let py_history = PyList::empty(py);
                for msg in history {
                    let dict = PyDict::new(py);
                    dict.set_item("role", msg.role)?;
                    dict.set_item("content", msg.content)?;
                    py_history.append(dict)?;
                }
                kwargs.set_item("conversation_history", py_history)?;
            }

            // Add available notebooks if provided
            if let Some(notebooks) = available_notebooks {
                let py_notebooks = PyList::empty(py);
                for nb in notebooks {
                    let dict = PyDict::new(py);
                    dict.set_item("id", nb.id)?;
                    dict.set_item("name", nb.name)?;
                    py_notebooks.append(dict)?;
                }
                kwargs.set_item("available_notebooks", py_notebooks)?;
            }

            // Add current notebook ID if provided
            if let Some(notebook_id) = current_notebook_id {
                kwargs.set_item("current_notebook_id", notebook_id)?;
            }

            let result = chat_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract actions
            let actions_list = result_dict
                .get("actions")
                .map(|v| {
                    v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py)
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let actions: Vec<AIAction> = actions_list
                .into_iter()
                .map(|a| {
                    let tool = a.get("tool")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default();
                    let tool_call_id = a.get("tool_call_id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default();

                    // Extract arguments as JSON
                    let arguments = a.get("arguments")
                        .map(|v| {
                            // Convert Python dict to JSON string then parse
                            let json_module = py.import("json").ok();
                            if let Some(json_mod) = json_module {
                                if let Ok(dumps) = json_mod.getattr("dumps") {
                                    if let Ok(json_str) = dumps.call1((v,)) {
                                        if let Ok(s) = json_str.extract::<String>() {
                                            return serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                                        }
                                    }
                                }
                            }
                            serde_json::Value::Null
                        })
                        .unwrap_or(serde_json::Value::Null);

                    AIAction {
                        tool,
                        arguments,
                        tool_call_id,
                    }
                })
                .collect();

            Ok(ChatResponseWithActions {
                content: result_dict
                    .get("content")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                model: result_dict
                    .get("model")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                provider: result_dict
                    .get("provider")
                    .map(|v| v.extract::<String>(py).unwrap_or_default())
                    .unwrap_or_default(),
                tokens_used: result_dict
                    .get("tokens_used")
                    .and_then(|v| v.extract::<i64>(py).ok()),
                finish_reason: result_dict
                    .get("finish_reason")
                    .and_then(|v| v.extract::<String>(py).ok()),
                actions,
                thinking: result_dict
                    .get("thinking")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .filter(|s| !s.is_empty()),
            })
        })
    }

    /// Chat with tools with streaming support
    /// Returns a channel receiver that yields StreamEvent items
    pub fn chat_with_tools_stream(
        &self,
        user_message: String,
        page_context: Option<PageContext>,
        conversation_history: Option<Vec<ChatMessage>>,
        available_notebooks: Option<Vec<NotebookInfo>>,
        current_notebook_id: Option<String>,
        config: AIConfig,
        system_prompt: Option<String>,
        library_path: Option<String>,
    ) -> Result<mpsc::Receiver<StreamEvent>> {
        let (tx, rx) = mpsc::channel();
        let nous_py_path = self.nous_py_path.clone();

        // Spawn a thread to run the Python code
        std::thread::spawn(move || {
            let result = Python::attach(|py| -> Result<()> {
                // Setup Python path using shared helper
                configure_python_path(py, &nous_py_path)?;

                log::info!("Python bridge: attempting to import nous_ai.chat");
                let chat_module = py.import("nous_ai.chat")?;
                let chat_fn = chat_module.getattr("chat_with_tools_stream_sync")?;

                // Create a Python callback that sends to our channel
                let tx_clone = tx.clone();
                let callback = pyo3::types::PyCFunction::new_closure(
                    py,
                    None,
                    None,
                    move |args: &Bound<'_, pyo3::types::PyTuple>, _kwargs: Option<&Bound<'_, PyDict>>| -> PyResult<()> {
                        if args.len() > 0 {
                            let event_dict: HashMap<String, Py<PyAny>> = args.get_item(0)?.extract()?;

                            Python::with_gil(|py| {
                                let event_type = event_dict.get("type")
                                    .and_then(|v| v.extract::<String>(py).ok())
                                    .unwrap_or_default();

                                let event = match event_type.as_str() {
                                    "chunk" => {
                                        let content = event_dict.get("content")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_default();
                                        StreamEvent::Chunk { content }
                                    }
                                    "thinking" => {
                                        let content = event_dict.get("content")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_default();
                                        StreamEvent::Thinking { content }
                                    }
                                    "action" => {
                                        let tool = event_dict.get("tool")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_default();
                                        let tool_call_id = event_dict.get("tool_call_id")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_default();
                                        let arguments = event_dict.get("arguments")
                                            .map(|v| {
                                                let json_module = py.import("json").ok();
                                                if let Some(json_mod) = json_module {
                                                    if let Ok(dumps) = json_mod.getattr("dumps") {
                                                        if let Ok(json_str) = dumps.call1((v,)) {
                                                            if let Ok(s) = json_str.extract::<String>() {
                                                                return serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
                                                            }
                                                        }
                                                    }
                                                }
                                                serde_json::Value::Null
                                            })
                                            .unwrap_or(serde_json::Value::Null);
                                        StreamEvent::Action { tool, arguments, tool_call_id }
                                    }
                                    "done" => {
                                        let model = event_dict.get("model")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_default();
                                        let tokens_used = event_dict.get("tokens_used")
                                            .and_then(|v| v.extract::<i64>(py).ok())
                                            .unwrap_or(0);
                                        StreamEvent::Done { model, tokens_used }
                                    }
                                    "error" => {
                                        let message = event_dict.get("message")
                                            .and_then(|v| v.extract::<String>(py).ok())
                                            .unwrap_or_else(|| "Unknown error".to_string());
                                        StreamEvent::Error { message }
                                    }
                                    other => {
                                        log::warn!("Unknown AI stream event type: {}", other);
                                        return;
                                    }
                                };

                                let _ = tx_clone.send(event);
                            });
                        }
                        Ok(())
                    },
                )?;

                let kwargs = PyDict::new(py);
                kwargs.set_item("user_message", user_message)?;
                kwargs.set_item("callback", callback)?;
                kwargs.set_item("provider_type", config.provider_type)?;

                if let Some(api_key) = config.api_key {
                    kwargs.set_item("api_key", api_key)?;
                }
                if let Some(model) = config.model {
                    kwargs.set_item("model", model)?;
                }
                if let Some(temp) = config.temperature {
                    kwargs.set_item("temperature", temp)?;
                }
                if let Some(max_tokens) = config.max_tokens {
                    kwargs.set_item("max_tokens", max_tokens)?;
                }

                if let Some(ctx) = page_context {
                    let ctx_dict = PyDict::new(py);
                    ctx_dict.set_item("page_id", ctx.page_id)?;
                    ctx_dict.set_item("title", ctx.title)?;
                    ctx_dict.set_item("content", ctx.content)?;
                    ctx_dict.set_item("tags", ctx.tags)?;
                    if let Some(notebook_name) = ctx.notebook_name {
                        ctx_dict.set_item("notebook_name", notebook_name)?;
                    }
                    kwargs.set_item("page_context", ctx_dict)?;
                }

                if let Some(history) = conversation_history {
                    let py_history = PyList::empty(py);
                    for msg in history {
                        let dict = PyDict::new(py);
                        dict.set_item("role", msg.role)?;
                        dict.set_item("content", msg.content)?;
                        py_history.append(dict)?;
                    }
                    kwargs.set_item("conversation_history", py_history)?;
                }

                if let Some(notebooks) = available_notebooks {
                    let py_notebooks = PyList::empty(py);
                    for nb in notebooks {
                        let dict = PyDict::new(py);
                        dict.set_item("id", nb.id)?;
                        dict.set_item("name", nb.name)?;
                        py_notebooks.append(dict)?;
                    }
                    kwargs.set_item("available_notebooks", py_notebooks)?;
                }

                if let Some(notebook_id) = current_notebook_id {
                    kwargs.set_item("current_notebook_id", notebook_id)?;
                }

                if let Some(prompt) = system_prompt {
                    kwargs.set_item("system_prompt", prompt)?;
                }

                if let Some(lib_path) = library_path {
                    kwargs.set_item("library_path", lib_path)?;
                }

                // Call the streaming function - this will block until complete
                // but will call our callback for each chunk
                chat_fn.call((), Some(&kwargs))?;

                Ok(())
            });

            // If there was an error, send it through the channel
            if let Err(e) = result {
                let _ = tx.send(StreamEvent::Error { message: e.to_string() });
            }
        });

        Ok(rx)
    }

    /// Summarize page content
    pub fn summarize_page(
        &self,
        content: String,
        title: Option<String>,
        max_length: Option<i64>,
        config: AIConfig,
    ) -> Result<String> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let summarize_fn = chat_module.getattr("summarize_page_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("content", content)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }
            if let Some(t) = title {
                kwargs.set_item("title", t)?;
            }
            if let Some(len) = max_length {
                kwargs.set_item("max_length", len)?;
            }

            let result = summarize_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(result_dict
                .get("summary")
                .map(|v| v.extract::<String>(py).unwrap_or_default())
                .unwrap_or_default())
        })
    }

    /// Summarize multiple pages into a single summary
    pub fn summarize_pages(
        &self,
        pages: Vec<PageSummaryInput>,
        custom_prompt: Option<String>,
        summary_style: Option<String>,
        config: AIConfig,
    ) -> Result<PagesSummaryResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let summarize_fn = chat_module.getattr("summarize_pages_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(prompt) = custom_prompt {
                kwargs.set_item("custom_prompt", prompt)?;
            }
            if let Some(style) = summary_style {
                kwargs.set_item("summary_style", style)?;
            }
            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }

            let result = summarize_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(PagesSummaryResult {
                summary: result_dict
                    .get("summary")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                key_points: result_dict
                    .get("key_points")
                    .and_then(|v| v.extract::<Vec<String>>(py).ok())
                    .unwrap_or_default(),
                action_items: result_dict
                    .get("action_items")
                    .and_then(|v| v.extract::<Vec<String>>(py).ok())
                    .unwrap_or_default(),
                themes: result_dict
                    .get("themes")
                    .and_then(|v| v.extract::<Vec<String>>(py).ok())
                    .unwrap_or_default(),
                pages_count: result_dict
                    .get("pages_count")
                    .and_then(|v| v.extract::<i64>(py).ok())
                    .unwrap_or(0),
                model: result_dict
                    .get("model")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                tokens_used: result_dict
                    .get("tokens_used")
                    .and_then(|v| v.extract::<i64>(py).ok()),
            })
        })
    }

    /// Suggest tags for page content
    pub fn suggest_tags(
        &self,
        content: String,
        existing_tags: Option<Vec<String>>,
        config: AIConfig,
    ) -> Result<Vec<String>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let suggest_fn = chat_module.getattr("suggest_page_tags_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("content", content)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }
            if let Some(tags) = existing_tags {
                kwargs.set_item("existing_tags", tags)?;
            }

            let result = suggest_fn.call((), Some(&kwargs))?;
            let tags: Vec<String> = result.extract()?;

            Ok(tags)
        })
    }

    /// Suggest related pages to link based on content analysis
    pub fn suggest_related_pages(
        &self,
        content: String,
        title: String,
        available_pages: Vec<PageInfo>,
        existing_links: Option<Vec<String>>,
        max_suggestions: Option<i64>,
        config: AIConfig,
    ) -> Result<Vec<RelatedPageSuggestion>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let suggest_fn = chat_module.getattr("suggest_related_pages_sync")?;

            // Convert available_pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in available_pages {
                let dict = PyDict::new(py);
                dict.set_item("id", page.id)?;
                dict.set_item("title", page.title)?;
                if let Some(summary) = page.summary {
                    dict.set_item("summary", summary)?;
                }
                py_pages.append(dict)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("content", content)?;
            kwargs.set_item("title", title)?;
            kwargs.set_item("available_pages", py_pages)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(links) = existing_links {
                kwargs.set_item("existing_links", links)?;
            }
            if let Some(max) = max_suggestions {
                kwargs.set_item("max_suggestions", max)?;
            }
            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }

            let result = suggest_fn.call((), Some(&kwargs))?;
            let suggestions_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let suggestions: Vec<RelatedPageSuggestion> = suggestions_list
                .into_iter()
                .map(|s| RelatedPageSuggestion {
                    id: s.get("id").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    title: s.get("title").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    reason: s.get("reason").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                })
                .collect();

            Ok(suggestions)
        })
    }

    // ===== Web Research Methods =====

    /// Search the web using Tavily API
    pub fn web_search(
        &self,
        query: String,
        api_key: String,
        max_results: i64,
        search_depth: String,
        include_answer: bool,
    ) -> Result<SearchResponse> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let web_module = py.import("nous_ai.web_research")?;
            let search_fn = web_module.getattr("web_search_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("query", query)?;
            kwargs.set_item("api_key", api_key)?;
            kwargs.set_item("max_results", max_results)?;
            kwargs.set_item("search_depth", search_depth)?;
            kwargs.set_item("include_answer", include_answer)?;

            let result = search_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract results list
            let results_list = result_dict
                .get("results")
                .map(|v| {
                    v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py)
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let results: Vec<SearchResult> = results_list
                .into_iter()
                .map(|r| SearchResult {
                    title: r.get("title").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    url: r.get("url").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    content: r.get("content").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    score: r.get("score").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                    published_date: r.get("published_date").and_then(|v| v.extract::<String>(py).ok()),
                })
                .collect();

            let follow_up: Vec<String> = result_dict
                .get("follow_up_questions")
                .and_then(|v| v.extract::<Vec<String>>(py).ok())
                .unwrap_or_default();

            Ok(SearchResponse {
                query: result_dict.get("query").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                results,
                answer: result_dict.get("answer").and_then(|v| v.extract::<String>(py).ok()),
                follow_up_questions: follow_up,
            })
        })
    }

    /// Scrape content from a URL
    pub fn scrape_url(&self, url: String) -> Result<ScrapedContent> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let web_module = py.import("nous_ai.web_research")?;
            let scrape_fn = web_module.getattr("scrape_url_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("url", url)?;

            let result = scrape_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(ScrapedContent {
                url: result_dict.get("url").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                title: result_dict.get("title").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                content: result_dict.get("content").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                author: result_dict.get("author").and_then(|v| v.extract::<String>(py).ok()),
                published_date: result_dict.get("published_date").and_then(|v| v.extract::<String>(py).ok()),
                word_count: result_dict.get("word_count").and_then(|v| v.extract::<i64>(py).ok()).unwrap_or(0),
            })
        })
    }

    /// Summarize research results using AI
    pub fn summarize_research(
        &self,
        contents: Vec<ScrapedContent>,
        query: String,
        config: AIConfig,
    ) -> Result<ResearchSummary> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let web_module = py.import("nous_ai.web_research")?;
            let summarize_fn = web_module.getattr("summarize_research_sync")?;

            // Convert contents to Python list of dicts
            let py_contents = PyList::empty(py);
            for c in contents {
                let dict = PyDict::new(py);
                dict.set_item("url", c.url)?;
                dict.set_item("title", c.title)?;
                dict.set_item("content", c.content)?;
                if let Some(author) = c.author {
                    dict.set_item("author", author)?;
                }
                if let Some(date) = c.published_date {
                    dict.set_item("published_date", date)?;
                }
                dict.set_item("word_count", c.word_count)?;
                py_contents.append(dict)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("contents", py_contents)?;
            kwargs.set_item("query", query)?;
            kwargs.set_item("provider_type", config.provider_type)?;

            if let Some(api_key) = config.api_key {
                kwargs.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                kwargs.set_item("model", model)?;
            }

            let result = summarize_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract sources
            let sources_list = result_dict
                .get("sources")
                .map(|v| {
                    v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py)
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let sources: Vec<SourceRef> = sources_list
                .into_iter()
                .map(|s| SourceRef {
                    title: s.get("title").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    url: s.get("url").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                })
                .collect();

            Ok(ResearchSummary {
                summary: result_dict.get("summary").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                key_points: result_dict.get("key_points").and_then(|v| v.extract::<Vec<String>>(py).ok()).unwrap_or_default(),
                sources,
                suggested_tags: result_dict.get("suggested_tags").and_then(|v| v.extract::<Vec<String>>(py).ok()).unwrap_or_default(),
            })
        })
    }

    /// Classify an inbox item to determine where it should be filed
    pub fn classify_inbox_item(
        &self,
        title: &str,
        content: &str,
        tags: &[String],
        notebooks: &[serde_json::Value],
        pages: &[serde_json::Value],
    ) -> Result<crate::inbox::InboxClassification> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let inbox_module = py.import("nous_ai.inbox")?;
            let classify_fn = inbox_module.getattr("classify_inbox_item_sync")?;

            // Convert notebooks to Python list
            let py_notebooks = PyList::empty(py);
            for nb in notebooks {
                let dict = PyDict::new(py);
                if let Some(id) = nb.get("id").and_then(|v| v.as_str()) {
                    dict.set_item("id", id)?;
                }
                if let Some(name) = nb.get("name").and_then(|v| v.as_str()) {
                    dict.set_item("name", name)?;
                }
                py_notebooks.append(dict)?;
            }

            // Convert pages to Python list
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                if let Some(notebook_id) = page.get("notebookId").and_then(|v| v.as_str()) {
                    dict.set_item("notebook_id", notebook_id)?;
                }
                if let Some(notebook_name) = page.get("notebookName").and_then(|v| v.as_str()) {
                    dict.set_item("notebook_name", notebook_name)?;
                }
                if let Some(page_id) = page.get("pageId").and_then(|v| v.as_str()) {
                    dict.set_item("page_id", page_id)?;
                }
                if let Some(title) = page.get("title").and_then(|v| v.as_str()) {
                    dict.set_item("title", title)?;
                }
                py_pages.append(dict)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("title", title)?;
            kwargs.set_item("content", content)?;
            kwargs.set_item("tags", tags.to_vec())?;
            kwargs.set_item("notebooks", py_notebooks)?;
            kwargs.set_item("pages", py_pages)?;

            let result = classify_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract action type and build ClassificationAction
            let action_type = result_dict
                .get("action_type")
                .and_then(|v| v.extract::<String>(py).ok())
                .unwrap_or_else(|| "keep_in_inbox".to_string());

            let action = match action_type.as_str() {
                "create_page" => {
                    let notebook_id_str = result_dict
                        .get("notebook_id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default();
                    let notebook_id = uuid::Uuid::parse_str(&notebook_id_str)
                        .unwrap_or_else(|_| uuid::Uuid::nil());

                    crate::inbox::ClassificationAction::CreatePage {
                        notebook_id,
                        notebook_name: result_dict
                            .get("notebook_name")
                            .and_then(|v| v.extract::<String>(py).ok())
                            .unwrap_or_default(),
                        suggested_title: result_dict
                            .get("suggested_title")
                            .and_then(|v| v.extract::<String>(py).ok())
                            .unwrap_or_else(|| title.to_string()),
                        suggested_tags: result_dict
                            .get("suggested_tags")
                            .and_then(|v| v.extract::<Vec<String>>(py).ok())
                            .unwrap_or_default(),
                    }
                }
                "append_to_page" => {
                    let notebook_id_str = result_dict
                        .get("notebook_id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default();
                    let notebook_id = uuid::Uuid::parse_str(&notebook_id_str)
                        .unwrap_or_else(|_| uuid::Uuid::nil());

                    let page_id_str = result_dict
                        .get("page_id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default();
                    let page_id = uuid::Uuid::parse_str(&page_id_str)
                        .unwrap_or_else(|_| uuid::Uuid::nil());

                    crate::inbox::ClassificationAction::AppendToPage {
                        notebook_id,
                        notebook_name: result_dict
                            .get("notebook_name")
                            .and_then(|v| v.extract::<String>(py).ok())
                            .unwrap_or_default(),
                        page_id,
                        page_title: result_dict
                            .get("page_title")
                            .and_then(|v| v.extract::<String>(py).ok())
                            .unwrap_or_default(),
                    }
                }
                "create_notebook" => crate::inbox::ClassificationAction::CreateNotebook {
                    suggested_name: result_dict
                        .get("suggested_name")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_else(|| "New Notebook".to_string()),
                    suggested_icon: result_dict
                        .get("suggested_icon")
                        .and_then(|v| v.extract::<String>(py).ok()),
                },
                _ => crate::inbox::ClassificationAction::KeepInInbox {
                    reason: result_dict
                        .get("reason")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_else(|| "Could not determine appropriate destination".to_string()),
                },
            };

            let confidence = result_dict
                .get("confidence")
                .and_then(|v| v.extract::<f32>(py).ok())
                .unwrap_or(0.5);

            let reasoning = result_dict
                .get("reasoning")
                .and_then(|v| v.extract::<String>(py).ok())
                .unwrap_or_default();

            Ok(crate::inbox::InboxClassification {
                action,
                confidence,
                reasoning,
                classified_at: chrono::Utc::now(),
            })
        })
    }

    // ===== Smart Organize =====

    /// Suggest which notebook pages should be organized into using AI
    pub fn smart_organize(
        &self,
        pages: &[serde_json::Value],
        destinations: &[serde_json::Value],
    ) -> Result<Vec<serde_json::Value>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let organize_module = py.import("nous_ai.organize")?;
            let suggest_fn = organize_module.getattr("suggest_organization_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                if let Some(id) = page.get("id").and_then(|v| v.as_str()) {
                    dict.set_item("id", id)?;
                }
                if let Some(title) = page.get("title").and_then(|v| v.as_str()) {
                    dict.set_item("title", title)?;
                }
                if let Some(content_summary) = page.get("content_summary").and_then(|v| v.as_str()) {
                    dict.set_item("content_summary", content_summary)?;
                }
                if let Some(tags) = page.get("tags").and_then(|v| v.as_array()) {
                    let py_tags: Vec<String> = tags
                        .iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect();
                    dict.set_item("tags", py_tags)?;
                }
                py_pages.append(dict)?;
            }

            // Convert destinations to Python list of dicts
            let py_destinations = PyList::empty(py);
            for dest in destinations {
                let dict = PyDict::new(py);
                if let Some(id) = dest.get("id").and_then(|v| v.as_str()) {
                    dict.set_item("id", id)?;
                }
                if let Some(name) = dest.get("name").and_then(|v| v.as_str()) {
                    dict.set_item("name", name)?;
                }
                if let Some(sample_titles) = dest.get("sample_page_titles").and_then(|v| v.as_array()) {
                    let titles: Vec<String> = sample_titles
                        .iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect();
                    dict.set_item("sample_page_titles", titles)?;
                }
                py_destinations.append(dict)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("destinations", py_destinations)?;

            let result = suggest_fn.call((), Some(&kwargs))?;
            let result_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            // Convert Python dicts back to serde_json::Value
            let mut suggestions = Vec::new();
            for item in result_list {
                let page_id = item
                    .get("page_id")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default();

                let suggested_notebook_id = item
                    .get("suggested_notebook_id")
                    .and_then(|v| {
                        // Handle Python None -> null
                        if v.is_none(py) {
                            None
                        } else {
                            v.extract::<String>(py).ok()
                        }
                    });

                let confidence = item
                    .get("confidence")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0);

                let reasoning = item
                    .get("reasoning")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default();

                let mut suggestion = serde_json::Map::new();
                suggestion.insert("page_id".to_string(), serde_json::Value::String(page_id));
                match suggested_notebook_id {
                    Some(id) => suggestion.insert(
                        "suggested_notebook_id".to_string(),
                        serde_json::Value::String(id),
                    ),
                    None => suggestion.insert(
                        "suggested_notebook_id".to_string(),
                        serde_json::Value::Null,
                    ),
                };
                suggestion.insert(
                    "confidence".to_string(),
                    serde_json::json!(confidence),
                );
                suggestion.insert(
                    "reasoning".to_string(),
                    serde_json::Value::String(reasoning),
                );

                suggestions.push(serde_json::Value::Object(suggestion));
            }

            Ok(suggestions)
        })
    }

    // ===== Document Conversion (markitdown) =====

    /// Convert a document to Markdown using markitdown
    pub fn convert_document(&self, file_path: String) -> Result<DocumentConversionResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let doc_module = py.import("nous_ai.document_convert")?;
            let convert_fn = doc_module.getattr("convert_document_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("file_path", file_path)?;

            let result = convert_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(DocumentConversionResult {
                content: result_dict
                    .get("content")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                source_path: result_dict
                    .get("source_path")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                source_type: result_dict
                    .get("source_type")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                title: result_dict
                    .get("title")
                    .and_then(|v| v.extract::<String>(py).ok()),
                word_count: result_dict
                    .get("word_count")
                    .and_then(|v| v.extract::<i64>(py).ok())
                    .unwrap_or(0),
                error: result_dict
                    .get("error")
                    .and_then(|v| v.extract::<String>(py).ok()),
            })
        })
    }

    /// Convert multiple documents to Markdown
    pub fn convert_documents_batch(
        &self,
        file_paths: Vec<String>,
    ) -> Result<Vec<DocumentConversionResult>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let doc_module = py.import("nous_ai.document_convert")?;
            let convert_fn = doc_module.getattr("convert_documents_batch_sync")?;

            // Convert file paths to Python list
            let py_paths = PyList::empty(py);
            for path in file_paths {
                py_paths.append(path)?;
            }

            let kwargs = PyDict::new(py);
            kwargs.set_item("file_paths", py_paths)?;

            let result = convert_fn.call((), Some(&kwargs))?;
            let result_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let mut results = Vec::new();
            for result_dict in result_list {
                results.push(DocumentConversionResult {
                    content: result_dict
                        .get("content")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    source_path: result_dict
                        .get("source_path")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    source_type: result_dict
                        .get("source_type")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    title: result_dict
                        .get("title")
                        .and_then(|v| v.extract::<String>(py).ok()),
                    word_count: result_dict
                        .get("word_count")
                        .and_then(|v| v.extract::<i64>(py).ok())
                        .unwrap_or(0),
                    error: result_dict
                        .get("error")
                        .and_then(|v| v.extract::<String>(py).ok()),
                });
            }

            Ok(results)
        })
    }

    /// Get list of supported file extensions for document conversion
    pub fn get_supported_extensions(&self) -> Result<Vec<String>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let doc_module = py.import("nous_ai.document_convert")?;
            let get_ext_fn = doc_module.getattr("get_supported_extensions_sync")?;

            let result = get_ext_fn.call0()?;
            let extensions: Vec<String> = result.extract()?;

            Ok(extensions)
        })
    }

    /// Check if a file type is supported for conversion
    pub fn is_supported_file(&self, file_path: String) -> Result<bool> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let doc_module = py.import("nous_ai.document_convert")?;
            let is_supported_fn = doc_module.getattr("is_supported_file_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("file_path", file_path)?;

            let result = is_supported_fn.call((), Some(&kwargs))?;
            let is_supported: bool = result.extract()?;

            Ok(is_supported)
        })
    }

    // ===== Browser Automation =====

    /// Run a browser automation task using AI
    pub fn run_browser_task(
        &self,
        task: &str,
        provider_type: &str,
        api_key: &str,
        model: &str,
        capture_screenshot: bool,
    ) -> Result<BrowserTaskResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let browser_module = py.import("nous_ai.browser_automation")?;
            let run_fn = browser_module.getattr("run_browser_task_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("task", task)?;
            kwargs.set_item("provider_type", provider_type)?;
            kwargs.set_item("api_key", api_key)?;
            kwargs.set_item("model", model)?;
            kwargs.set_item("capture_screenshot", capture_screenshot)?;

            let result = run_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(BrowserTaskResult {
                success: result_dict
                    .get("success")
                    .and_then(|v| v.extract::<bool>(py).ok())
                    .unwrap_or(false),
                content: result_dict
                    .get("content")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                screenshot: result_dict
                    .get("screenshot")
                    .and_then(|v| v.extract::<String>(py).ok()),
                structured_data: result_dict
                    .get("structured_data")
                    .and_then(|v| {
                        // Convert Python dict to JSON value
                        let json_mod = py.import("json").ok()?;
                        let json_str: String = json_mod
                            .getattr("dumps").ok()?
                            .call1((v,)).ok()?
                            .extract().ok()?;
                        serde_json::from_str(&json_str).ok()
                    }),
                error: result_dict
                    .get("error")
                    .and_then(|v| v.extract::<String>(py).ok()),
            })
        })
    }

    // ===== Video Transcription =====

    /// Transcribe a video file using faster-whisper
    pub fn transcribe_video(
        &self,
        video_path: &str,
        model_size: Option<&str>,
        language: Option<&str>,
    ) -> Result<TranscriptionResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let video_module = py.import("nous_ai.video_transcribe")?;
            let transcribe_fn = video_module.getattr("transcribe_video_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("video_path", video_path)?;
            if let Some(size) = model_size {
                kwargs.set_item("model_size", size)?;
            }
            if let Some(lang) = language {
                kwargs.set_item("language", lang)?;
            }

            let result = transcribe_fn.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract segments
            let segments_list = result_dict
                .get("segments")
                .map(|v| {
                    v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py)
                        .unwrap_or_default()
                })
                .unwrap_or_default();

            let segments: Vec<TranscriptSegment> = segments_list
                .into_iter()
                .map(|s| {
                    // Extract words for this segment
                    let words_list = s
                        .get("words")
                        .map(|v| {
                            v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py)
                                .unwrap_or_default()
                        })
                        .unwrap_or_default();

                    let words: Vec<TranscriptWord> = words_list
                        .into_iter()
                        .map(|w| TranscriptWord {
                            word: w.get("word").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                            start: w.get("start").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                            end: w.get("end").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                            probability: w.get("probability").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                        })
                        .collect();

                    TranscriptSegment {
                        id: s.get("id").and_then(|v| v.extract::<i64>(py).ok()).unwrap_or(0),
                        start: s.get("start").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                        end: s.get("end").and_then(|v| v.extract::<f64>(py).ok()).unwrap_or(0.0),
                        text: s.get("text").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                        words,
                    }
                })
                .collect();

            Ok(TranscriptionResult {
                video_path: result_dict
                    .get("video_path")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                audio_path: result_dict
                    .get("audio_path")
                    .and_then(|v| v.extract::<String>(py).ok()),
                language: result_dict
                    .get("language")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                language_probability: result_dict
                    .get("language_probability")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0),
                duration: result_dict
                    .get("duration")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0),
                segments,
                word_count: result_dict
                    .get("word_count")
                    .and_then(|v| v.extract::<i64>(py).ok())
                    .unwrap_or(0),
                transcription_time: result_dict
                    .get("transcription_time")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0),
            })
        })
    }

    /// Get video duration in seconds
    pub fn get_video_duration(&self, video_path: &str) -> Result<f64> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let video_module = py.import("nous_ai.video_transcribe")?;
            let duration_fn = video_module.getattr("get_video_duration_sync")?;

            let result = duration_fn.call1((video_path,))?;
            let duration: f64 = result.extract()?;

            Ok(duration)
        })
    }

    /// Check if a file is a supported video format
    pub fn is_supported_video(&self, file_path: &str) -> Result<bool> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let video_module = py.import("nous_ai.video_transcribe")?;
            let check_fn = video_module.getattr("is_supported_video_sync")?;

            let result = check_fn.call1((file_path,))?;
            let is_supported: bool = result.extract()?;

            Ok(is_supported)
        })
    }

    /// Get list of supported video extensions
    pub fn get_supported_video_extensions(&self) -> Result<Vec<String>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let video_module = py.import("nous_ai.video_transcribe")?;
            let get_ext_fn = video_module.getattr("get_supported_extensions_sync")?;

            let result = get_ext_fn.call0()?;
            let extensions: Vec<String> = result.extract()?;

            Ok(extensions)
        })
    }

    /// Extract a thumbnail frame from a video
    pub fn extract_video_thumbnail(
        &self,
        video_path: &str,
        output_path: Option<&str>,
        timestamp_seconds: Option<f64>,
        width: Option<i32>,
    ) -> Result<String> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let video_module = py.import("nous_ai.video_transcribe")?;
            let extract_fn = video_module.getattr("extract_thumbnail_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("video_path", video_path)?;
            if let Some(output) = output_path {
                kwargs.set_item("output_path", output)?;
            }
            if let Some(ts) = timestamp_seconds {
                kwargs.set_item("timestamp_seconds", ts)?;
            }
            if let Some(w) = width {
                kwargs.set_item("width", w)?;
            }

            let result = extract_fn.call((), Some(&kwargs))?;
            let thumbnail_path: String = result.extract()?;

            Ok(thumbnail_path)
        })
    }

    // ===== Jupyter Cell Execution =====

    /// Execute a Jupyter notebook code cell
    pub fn execute_jupyter_cell(&self, code: String, cell_index: usize) -> Result<JupyterCellOutput> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let jupyter_module = py.import("nous_ai.jupyter_execute")?;
            let execute_fn = jupyter_module.getattr("execute_cell")?;

            let result = execute_fn.call1((code, cell_index))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            let success = result_dict
                .get("success")
                .and_then(|v| v.extract::<bool>(py).ok())
                .unwrap_or(false);

            let execution_count = result_dict
                .get("execution_count")
                .and_then(|v| v.extract::<i64>(py).ok())
                .map(|v| v as usize);

            // Extract outputs as JSON
            let outputs = result_dict
                .get("outputs")
                .map(|v| {
                    let json_module = py.import("json").ok();
                    if let Some(json_mod) = json_module {
                        if let Ok(dumps) = json_mod.getattr("dumps") {
                            if let Ok(json_str) = dumps.call1((v,)) {
                                if let Ok(s) = json_str.extract::<String>() {
                                    return serde_json::from_str(&s).unwrap_or(serde_json::Value::Array(vec![]));
                                }
                            }
                        }
                    }
                    serde_json::Value::Array(vec![])
                })
                .unwrap_or(serde_json::Value::Array(vec![]));

            Ok(JupyterCellOutput {
                success,
                outputs,
                execution_count,
            })
        })
    }

    /// Check if Python execution is available
    pub fn check_python_available(&self) -> Result<PythonEnvironmentInfo> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let jupyter_module = py.import("nous_ai.jupyter_execute")?;
            let check_fn = jupyter_module.getattr("check_python_available")?;

            let result = check_fn.call0()?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            Ok(PythonEnvironmentInfo {
                available: result_dict
                    .get("available")
                    .and_then(|v| v.extract::<bool>(py).ok())
                    .unwrap_or(false),
                python_version: result_dict
                    .get("python_version")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_default(),
                packages: result_dict
                    .get("packages")
                    .and_then(|v| v.extract::<Vec<String>>(py).ok())
                    .unwrap_or_default(),
            })
        })
    }

    // ===== MCP Server Management Methods =====

    /// Load MCP server configuration for a library
    pub fn mcp_load_config(&self, library_path: &str) -> Result<MCPServersConfig> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let load_fn = mcp_module.getattr("mcp_load_config_sync")?;

            let result = load_fn.call1((library_path,))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            let servers_list = result_dict
                .get("servers")
                .map(|v| v.extract::<Vec<HashMap<String, Py<PyAny>>>>(py).unwrap_or_default())
                .unwrap_or_default();

            let servers: Vec<MCPServerConfig> = servers_list
                .into_iter()
                .map(|s| MCPServerConfig {
                    name: s.get("name").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    command: s.get("command").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                    args: s.get("args").and_then(|v| v.extract::<Vec<String>>(py).ok()).unwrap_or_default(),
                    env: s.get("env").and_then(|v| v.extract::<HashMap<String, String>>(py).ok()).unwrap_or_default(),
                    enabled: s.get("enabled").and_then(|v| v.extract::<bool>(py).ok()).unwrap_or(true),
                    timeout_seconds: s.get("timeout_seconds").and_then(|v| v.extract::<i64>(py).ok()).unwrap_or(30),
                })
                .collect();

            Ok(MCPServersConfig { servers })
        })
    }

    /// Save MCP server configuration for a library
    pub fn mcp_save_config(&self, library_path: &str, config: MCPServersConfig) -> Result<()> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let save_fn = mcp_module.getattr("mcp_save_config_sync")?;

            // Convert config to Python dict
            let config_dict = PyDict::new(py);
            let servers_list = PyList::empty(py);

            for server in &config.servers {
                let server_dict = PyDict::new(py);
                server_dict.set_item("name", &server.name)?;
                server_dict.set_item("command", &server.command)?;
                server_dict.set_item("args", &server.args)?;

                let env_dict = PyDict::new(py);
                for (k, v) in &server.env {
                    env_dict.set_item(k, v)?;
                }
                server_dict.set_item("env", env_dict)?;
                server_dict.set_item("enabled", server.enabled)?;
                server_dict.set_item("timeout_seconds", server.timeout_seconds)?;

                servers_list.append(server_dict)?;
            }
            config_dict.set_item("servers", servers_list)?;

            save_fn.call1((library_path, config_dict))?;
            Ok(())
        })
    }

    /// Start all enabled MCP servers for a library
    pub fn mcp_start_servers(&self, library_path: &str) -> Result<Vec<String>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let start_fn = mcp_module.getattr("mcp_start_servers_sync")?;

            let result = start_fn.call1((library_path,))?;
            let started: Vec<String> = result.extract()?;

            Ok(started)
        })
    }

    /// Stop all MCP servers for a library
    pub fn mcp_stop_servers(&self, library_path: &str) -> Result<()> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let stop_fn = mcp_module.getattr("mcp_stop_servers_sync")?;

            stop_fn.call1((library_path,))?;
            Ok(())
        })
    }

    /// Get all tools from running MCP servers
    pub fn mcp_get_tools(&self, library_path: &str) -> Result<Vec<MCPTool>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let get_tools_fn = mcp_module.getattr("mcp_get_tools_sync")?;

            let result = get_tools_fn.call1((library_path,))?;
            let tools_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let tools: Vec<MCPTool> = tools_list
                .into_iter()
                .map(|t| {
                    let input_schema = t.get("input_schema")
                        .map(|v| {
                            let json_module = py.import("json").ok();
                            if let Some(json_mod) = json_module {
                                if let Ok(dumps) = json_mod.getattr("dumps") {
                                    if let Ok(json_str) = dumps.call1((v,)) {
                                        if let Ok(s) = json_str.extract::<String>() {
                                            return serde_json::from_str(&s).unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                        }
                                    }
                                }
                            }
                            serde_json::Value::Object(serde_json::Map::new())
                        })
                        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                    MCPTool {
                        server_name: t.get("server_name").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                        name: t.get("name").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                        description: t.get("description").and_then(|v| v.extract::<String>(py).ok()),
                        input_schema,
                    }
                })
                .collect();

            Ok(tools)
        })
    }

    /// Call a tool on an MCP server
    pub fn mcp_call_tool(
        &self,
        library_path: &str,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<MCPToolResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let call_fn = mcp_module.getattr("mcp_call_tool_sync")?;

            // Convert arguments to Python dict
            let json_module = py.import("json")?;
            let loads = json_module.getattr("loads")?;
            let args_str = serde_json::to_string(&arguments).unwrap_or_else(|_| "{}".to_string());
            let py_args = loads.call1((args_str,))?;

            let result = call_fn.call1((library_path, server_name, tool_name, py_args))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            let content = result_dict.get("content")
                .map(|v| {
                    let json_mod = py.import("json").ok();
                    if let Some(jm) = json_mod {
                        if let Ok(dumps) = jm.getattr("dumps") {
                            if let Ok(json_str) = dumps.call1((v,)) {
                                if let Ok(s) = json_str.extract::<String>() {
                                    return serde_json::from_str(&s).ok();
                                }
                            }
                        }
                    }
                    // Fallback: try to extract as string
                    v.extract::<String>(py).ok().map(|s| serde_json::Value::String(s))
                })
                .flatten();

            Ok(MCPToolResult {
                server_name: result_dict.get("server_name").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                tool_name: result_dict.get("tool_name").and_then(|v| v.extract::<String>(py).ok()).unwrap_or_default(),
                success: result_dict.get("success").and_then(|v| v.extract::<bool>(py).ok()).unwrap_or(false),
                content,
                error: result_dict.get("error").and_then(|v| v.extract::<String>(py).ok()),
            })
        })
    }

    /// Get list of running MCP server names
    pub fn mcp_get_running_servers(&self, library_path: &str) -> Result<Vec<String>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let mcp_module = py.import("nous_ai.mcp_client")?;
            let get_fn = mcp_module.getattr("mcp_get_running_servers_sync")?;

            let result = get_fn.call1((library_path,))?;
            let servers: Vec<String> = result.extract()?;

            Ok(servers)
        })
    }

    // ===== Embedding Methods for RAG =====

    /// Generate embedding for a single text
    pub fn generate_embedding(&self, text: &str, config: &str) -> Result<Vec<f64>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let embed_module = py.import("nous_ai.embeddings")?;
            let embed_fn = embed_module.getattr("generate_embedding_sync")?;

            // Parse config JSON to Python dict
            let config_dict: serde_json::Value = serde_json::from_str(config)?;
            let py_config = PyDict::new(py);

            if let serde_json::Value::Object(map) = config_dict {
                for (key, value) in map {
                    match value {
                        serde_json::Value::String(s) => py_config.set_item(key, s)?,
                        serde_json::Value::Number(n) => {
                            if let Some(i) = n.as_i64() {
                                py_config.set_item(key, i)?;
                            } else if let Some(f) = n.as_f64() {
                                py_config.set_item(key, f)?;
                            }
                        }
                        serde_json::Value::Null => py_config.set_item(key, py.None())?,
                        _ => {}
                    }
                }
            }

            let result = embed_fn.call1((text, py_config))?;
            let embedding: Vec<f64> = result.extract()?;

            Ok(embedding)
        })
    }

    /// Generate embeddings for multiple texts
    pub fn generate_embeddings_batch(&self, texts: Vec<&str>, config: &str) -> Result<Vec<Vec<f64>>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let embed_module = py.import("nous_ai.embeddings")?;
            let embed_fn = embed_module.getattr("generate_embeddings_batch_sync")?;

            // Convert texts to Python list
            let py_texts = PyList::empty(py);
            for text in texts {
                py_texts.append(text)?;
            }

            // Parse config JSON to Python dict
            let config_dict: serde_json::Value = serde_json::from_str(config)?;
            let py_config = PyDict::new(py);

            if let serde_json::Value::Object(map) = config_dict {
                for (key, value) in map {
                    match value {
                        serde_json::Value::String(s) => py_config.set_item(key, s)?,
                        serde_json::Value::Number(n) => {
                            if let Some(i) = n.as_i64() {
                                py_config.set_item(key, i)?;
                            } else if let Some(f) = n.as_f64() {
                                py_config.set_item(key, f)?;
                            }
                        }
                        serde_json::Value::Null => py_config.set_item(key, py.None())?,
                        _ => {}
                    }
                }
            }

            let result = embed_fn.call1((py_texts, py_config))?;
            let embeddings: Vec<Vec<f64>> = result.extract()?;

            Ok(embeddings)
        })
    }

    /// Discover available embedding models from a provider
    pub fn discover_embedding_models(&self, provider: &str, base_url: Option<&str>) -> Result<Vec<DiscoveredModel>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let embed_module = py.import("nous_ai.embeddings")?;
            let discover_fn = embed_module.getattr("discover_models_sync")?;

            let result = discover_fn.call1((provider, base_url))?;
            let models_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let mut models = Vec::new();
            for model_dict in models_list {
                models.push(DiscoveredModel {
                    id: model_dict
                        .get("id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    name: model_dict
                        .get("name")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    dimensions: model_dict
                        .get("dimensions")
                        .and_then(|v| v.extract::<i64>(py).ok())
                        .unwrap_or(768) as u32,
                });
            }

            Ok(models)
        })
    }

    /// Discover available chat models from a local provider (ollama/lmstudio)
    // ===== Audio Generation =====

    /// Generate audio from page content (TTS or podcast mode)
    #[allow(clippy::too_many_arguments)]
    pub fn generate_page_audio(
        &self,
        content: &str,
        title: &str,
        output_dir: &str,
        mode: &str,
        tts_provider: &str,
        tts_voice: &str,
        tts_api_key: Option<&str>,
        tts_base_url: Option<&str>,
        tts_model: Option<&str>,
        tts_speed: Option<f64>,
        ai_config: Option<&AIConfig>,
        voice_b: Option<&str>,
        target_length: Option<&str>,
        custom_instructions: Option<&str>,
    ) -> Result<AudioGenerationResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let module = py.import("nous_ai.audio_generate")?;
            let func = module.getattr("generate_page_audio_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("content", content)?;
            kwargs.set_item("title", title)?;
            kwargs.set_item("output_dir", output_dir)?;
            kwargs.set_item("mode", mode)?;

            // Build tts_config dict
            let tts_config = PyDict::new(py);
            tts_config.set_item("provider", tts_provider)?;
            tts_config.set_item("voice", tts_voice)?;
            if let Some(key) = tts_api_key {
                tts_config.set_item("api_key", key)?;
            }
            if let Some(url) = tts_base_url {
                tts_config.set_item("base_url", url)?;
            }
            if let Some(model) = tts_model {
                tts_config.set_item("model", model)?;
            }
            if let Some(speed) = tts_speed {
                tts_config.set_item("speed", speed)?;
            }
            kwargs.set_item("tts_config", tts_config)?;

            // Build ai_config dict for podcast mode
            if let Some(ai_cfg) = ai_config {
                let ai_dict = PyDict::new(py);
                ai_dict.set_item("provider_type", &ai_cfg.provider_type)?;
                if let Some(ref key) = ai_cfg.api_key {
                    ai_dict.set_item("api_key", key)?;
                }
                if let Some(ref model) = ai_cfg.model {
                    ai_dict.set_item("model", model)?;
                }
                if let Some(max_tokens) = ai_cfg.max_tokens {
                    ai_dict.set_item("max_tokens", max_tokens)?;
                }
                kwargs.set_item("ai_config", ai_dict)?;
            }

            if let Some(vb) = voice_b {
                kwargs.set_item("voice_b", vb)?;
            }
            if let Some(length) = target_length {
                kwargs.set_item("target_length", length)?;
            }
            if let Some(instructions) = custom_instructions {
                kwargs.set_item("custom_instructions", instructions)?;
            }

            let result = func.call((), Some(&kwargs))?;
            let result_dict: HashMap<String, Py<PyAny>> = result.extract()?;

            // Extract transcript (list of dicts) if present
            let transcript = result_dict
                .get("transcript")
                .and_then(|v| {
                    v.extract::<Option<Vec<HashMap<String, Py<PyAny>>>>>(py)
                        .ok()
                        .flatten()
                })
                .map(|lines| {
                    lines
                        .into_iter()
                        .map(|line| PodcastLine {
                            speaker: line
                                .get("speaker")
                                .and_then(|v| v.extract::<String>(py).ok())
                                .unwrap_or_default(),
                            text: line
                                .get("text")
                                .and_then(|v| v.extract::<String>(py).ok())
                                .unwrap_or_default(),
                        })
                        .collect()
                });

            let audio_path = result_dict
                .get("audio_path")
                .and_then(|v| v.extract::<String>(py).ok())
                .unwrap_or_default();

            if audio_path.is_empty() {
                return Err(PythonError::TypeConversion(
                    "Audio generation failed: Python returned no audio_path. \
                     Check that the TTS provider is configured correctly and the API key is valid."
                        .to_string(),
                ));
            }

            Ok(AudioGenerationResult {
                audio_path,
                duration_seconds: result_dict
                    .get("duration_seconds")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0),
                format: result_dict
                    .get("format")
                    .and_then(|v| v.extract::<String>(py).ok())
                    .unwrap_or_else(|| "mp3".to_string()),
                file_size_bytes: result_dict
                    .get("file_size_bytes")
                    .and_then(|v| v.extract::<i64>(py).ok())
                    .unwrap_or(0),
                generation_time_seconds: result_dict
                    .get("generation_time_seconds")
                    .and_then(|v| v.extract::<f64>(py).ok())
                    .unwrap_or(0.0),
                transcript,
            })
        })
    }

    /// List available voices for a TTS provider
    pub fn list_tts_voices(
        &self,
        provider: &str,
        api_key: Option<&str>,
        base_url: Option<&str>,
    ) -> Result<Vec<TTSVoiceInfo>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let module = py.import("nous_ai.audio_generate")?;
            let func = module.getattr("list_tts_voices_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("provider", provider)?;
            if let Some(key) = api_key {
                kwargs.set_item("api_key", key)?;
            }
            if let Some(url) = base_url {
                kwargs.set_item("base_url", url)?;
            }

            let result = func.call((), Some(&kwargs))?;
            let voices_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let mut voices = Vec::new();
            for v in voices_list {
                voices.push(TTSVoiceInfo {
                    id: v
                        .get("id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    name: v
                        .get("name")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    language: v
                        .get("language")
                        .and_then(|v| v.extract::<Option<String>>(py).ok())
                        .flatten(),
                    preview_url: v
                        .get("preview_url")
                        .and_then(|v| v.extract::<Option<String>>(py).ok())
                        .flatten(),
                });
            }

            Ok(voices)
        })
    }

    /// Get available TTS providers and their status
    pub fn get_tts_providers(&self) -> Result<Vec<TTSProviderInfo>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let module = py.import("nous_ai.audio_generate")?;
            let func = module.getattr("get_tts_providers_sync")?;

            let result = func.call0()?;
            let providers_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let mut providers = Vec::new();
            for p in providers_list {
                providers.push(TTSProviderInfo {
                    id: p
                        .get("id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    name: p
                        .get("name")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    available: p
                        .get("available")
                        .and_then(|v| v.extract::<bool>(py).ok())
                        .unwrap_or(false),
                });
            }

            Ok(providers)
        })
    }

    pub fn discover_chat_models(&self, provider: &str, base_url: &str) -> Result<Vec<DiscoveredChatModel>> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("nous_ai.chat")?;
            let discover_fn = chat_module.getattr("discover_chat_models_sync")?;

            let result = discover_fn.call1((provider, base_url))?;
            let models_list: Vec<HashMap<String, Py<PyAny>>> = result.extract()?;

            let mut models = Vec::new();
            for model_dict in models_list {
                models.push(DiscoveredChatModel {
                    id: model_dict
                        .get("id")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                    name: model_dict
                        .get("name")
                        .and_then(|v| v.extract::<String>(py).ok())
                        .unwrap_or_default(),
                });
            }

            Ok(models)
        })
    }

    // ===== Study Tools Methods =====

    /// Generate a study guide from pages
    pub fn generate_study_guide(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
        options: Option<StudyGuideOptions>,
    ) -> Result<StudyGuide> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let generate_fn = study_module.getattr("generate_study_guide_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;

            // Add options if provided
            if let Some(opts) = options {
                let opts_dict = PyDict::new(py);
                opts_dict.set_item("depth", opts.depth)?;
                opts_dict.set_item("focus_areas", opts.focus_areas)?;
                opts_dict.set_item("num_practice_questions", opts.num_practice_questions)?;
                kwargs.set_item("options", opts_dict)?;
            }

            let result = generate_fn.call((), Some(&kwargs))?;

            // Convert Python result to JSON string then parse
            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let study_guide: StudyGuide = serde_json::from_str(&json_str)?;

            Ok(study_guide)
        })
    }

    /// Generate FAQ from pages
    pub fn generate_faq(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
        num_questions: Option<i32>,
    ) -> Result<FAQ> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let generate_fn = study_module.getattr("generate_faq_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;
            if let Some(num) = num_questions {
                kwargs.set_item("num_questions", num)?;
            }

            let result = generate_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let faq: FAQ = serde_json::from_str(&json_str)?;

            Ok(faq)
        })
    }

    /// Generate flashcards from pages
    pub fn generate_flashcards(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
        num_cards: Option<i32>,
        card_types: Option<Vec<String>>,
    ) -> Result<FlashcardGenerationResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let generate_fn = study_module.getattr("generate_flashcards_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;
            if let Some(num) = num_cards {
                kwargs.set_item("num_cards", num)?;
            }
            if let Some(types) = card_types {
                kwargs.set_item("card_types", types)?;
            }

            let result = generate_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let flashcards: FlashcardGenerationResult = serde_json::from_str(&json_str)?;

            Ok(flashcards)
        })
    }

    /// Generate briefing document from pages
    pub fn generate_briefing(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
        include_action_items: Option<bool>,
    ) -> Result<BriefingDocument> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let generate_fn = study_module.getattr("generate_briefing_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;
            if let Some(include) = include_action_items {
                kwargs.set_item("include_action_items", include)?;
            }

            let result = generate_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let briefing: BriefingDocument = serde_json::from_str(&json_str)?;

            Ok(briefing)
        })
    }

    /// Extract timeline from pages
    pub fn extract_timeline(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
    ) -> Result<Timeline> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let extract_fn = study_module.getattr("extract_timeline_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;

            let result = extract_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let timeline: Timeline = serde_json::from_str(&json_str)?;

            Ok(timeline)
        })
    }

    /// Extract concept graph from pages
    pub fn extract_concepts(
        &self,
        pages: Vec<StudyPageContent>,
        config: AIConfig,
        max_nodes: Option<i32>,
    ) -> Result<ConceptGraph> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let extract_fn = study_module.getattr("extract_concepts_sync")?;

            // Convert pages to Python list of dicts
            let py_pages = PyList::empty(py);
            for page in pages {
                let dict = PyDict::new(py);
                dict.set_item("page_id", page.page_id)?;
                dict.set_item("title", page.title)?;
                dict.set_item("content", page.content)?;
                dict.set_item("tags", page.tags)?;
                py_pages.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("pages", py_pages)?;
            kwargs.set_item("config", config_dict)?;
            if let Some(max) = max_nodes {
                kwargs.set_item("max_nodes", max)?;
            }

            let result = extract_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let concepts: ConceptGraph = serde_json::from_str(&json_str)?;

            Ok(concepts)
        })
    }

    /// Chat with RAG context and return response with citations
    pub fn chat_with_citations(
        &self,
        query: String,
        context_chunks: Vec<RAGChunk>,
        config: AIConfig,
        max_citations: Option<i32>,
    ) -> Result<CitedResponse> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let study_module = py.import("nous_ai.study_tools")?;
            let chat_fn = study_module.getattr("chat_with_citations_sync")?;

            // Convert chunks to Python list of dicts
            let py_chunks = PyList::empty(py);
            for chunk in context_chunks {
                let dict = PyDict::new(py);
                dict.set_item("chunk_id", chunk.chunk_id)?;
                dict.set_item("page_id", chunk.page_id)?;
                dict.set_item("notebook_id", chunk.notebook_id)?;
                dict.set_item("title", chunk.title)?;
                dict.set_item("content", chunk.content)?;
                dict.set_item("score", chunk.score)?;
                py_chunks.append(dict)?;
            }

            // Build config dict
            let config_dict = PyDict::new(py);
            config_dict.set_item("provider_type", config.provider_type)?;
            if let Some(api_key) = config.api_key {
                config_dict.set_item("api_key", api_key)?;
            }
            if let Some(model) = config.model {
                config_dict.set_item("model", model)?;
            }
            if let Some(temp) = config.temperature {
                config_dict.set_item("temperature", temp)?;
            }
            if let Some(max_tokens) = config.max_tokens {
                config_dict.set_item("max_tokens", max_tokens)?;
            }

            // Build kwargs
            let kwargs = PyDict::new(py);
            kwargs.set_item("query", query)?;
            kwargs.set_item("context_chunks", py_chunks)?;
            kwargs.set_item("config", config_dict)?;
            if let Some(max) = max_citations {
                kwargs.set_item("max_citations", max)?;
            }

            let result = chat_fn.call((), Some(&kwargs))?;

            let json_module = py.import("json")?;
            let dumps = json_module.getattr("dumps")?;
            let json_str: String = dumps.call1((result,))?.extract()?;
            let response: CitedResponse = serde_json::from_str(&json_str)?;

            Ok(response)
        })
    }
}

// ===== Audio Generation Types =====

/// Result from audio generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioGenerationResult {
    pub audio_path: String,
    pub duration_seconds: f64,
    pub format: String,
    pub file_size_bytes: i64,
    pub generation_time_seconds: f64,
    pub transcript: Option<Vec<PodcastLine>>,
}

/// A single line of podcast dialogue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastLine {
    pub speaker: String,
    pub text: String,
}

/// TTS voice information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSVoiceInfo {
    pub id: String,
    pub name: String,
    pub language: Option<String>,
    pub preview_url: Option<String>,
}

/// TTS provider information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSProviderInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
}

/// Discovered embedding model info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub name: String,
    pub dimensions: u32,
}

/// Discovered chat model info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredChatModel {
    pub id: String,
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chat_message_serialization() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "Hello!".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("user"));
        assert!(json.contains("Hello!"));
    }
}
