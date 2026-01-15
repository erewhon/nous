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

/// Python AI bridge for calling Python functions
pub struct PythonAI {
    katt_py_path: PathBuf,
}

impl PythonAI {
    /// Create a new PythonAI instance
    pub fn new(katt_py_path: PathBuf) -> Self {
        Self { katt_py_path }
    }

    /// Initialize Python path to include katt-py and its venv site-packages
    #[allow(deprecated)]
    fn setup_python_path(&self, py: Python<'_>) -> Result<()> {
        let sys = py.import("sys")?;
        let path = sys.getattr("path")?;
        let path_list: Bound<'_, PyList> = path.downcast_into().map_err(|e| {
            PythonError::TypeConversion(format!("Failed to convert sys.path to list: {}", e))
        })?;

        // Add katt-py source directory
        let katt_py_str = self.katt_py_path.to_string_lossy().to_string();
        let already_added = path_list.iter().any(|p| {
            p.extract::<String>().ok() == Some(katt_py_str.clone())
        });

        if !already_added {
            path_list.insert(0, katt_py_str.clone())?;
        }

        // Add venv site-packages for dependencies (pydantic, httpx, etc.)
        // Get Python version for site-packages path
        let version_info = sys.getattr("version_info")?;
        let major: i32 = version_info.getattr("major")?.extract()?;
        let minor: i32 = version_info.getattr("minor")?.extract()?;
        let site_packages = format!(
            "{}/.venv/lib/python{}.{}/site-packages",
            katt_py_str, major, minor
        );

        let site_already_added = path_list.iter().any(|p| {
            p.extract::<String>().ok() == Some(site_packages.clone())
        });

        if !site_already_added {
            path_list.insert(0, site_packages)?;
        }

        Ok(())
    }

    /// Send a chat request to the AI provider
    pub fn chat(&self, messages: Vec<ChatMessage>, config: AIConfig) -> Result<ChatResponse> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let chat_module = py.import("katt_ai.chat")?;
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

            let chat_module = py.import("katt_ai.chat")?;
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

            let chat_module = py.import("katt_ai.chat")?;
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
    ) -> Result<mpsc::Receiver<StreamEvent>> {
        let (tx, rx) = mpsc::channel();
        let katt_py_path = self.katt_py_path.clone();

        // Spawn a thread to run the Python code
        std::thread::spawn(move || {
            let result = Python::attach(|py| -> Result<()> {
                // Setup Python path
                let sys = py.import("sys")?;
                let path = sys.getattr("path")?;
                let path_list: Bound<'_, PyList> = path.downcast_into().map_err(|e| {
                    PythonError::TypeConversion(format!("Failed to convert sys.path to list: {}", e))
                })?;

                let katt_py_str = katt_py_path.to_string_lossy().to_string();
                let already_added = path_list.iter().any(|p| {
                    p.extract::<String>().ok() == Some(katt_py_str.clone())
                });

                if !already_added {
                    path_list.insert(0, katt_py_str.clone())?;
                }

                // Add venv site-packages
                let version_info = sys.getattr("version_info")?;
                let major: i32 = version_info.getattr("major")?.extract()?;
                let minor: i32 = version_info.getattr("minor")?.extract()?;
                let site_packages = format!(
                    "{}/.venv/lib/python{}.{}/site-packages",
                    katt_py_str, major, minor
                );

                let site_already_added = path_list.iter().any(|p| {
                    p.extract::<String>().ok() == Some(site_packages.clone())
                });

                if !site_already_added {
                    path_list.insert(0, site_packages)?;
                }

                let chat_module = py.import("katt_ai.chat")?;
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
                                    _ => return,
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

            let chat_module = py.import("katt_ai.chat")?;
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

            let chat_module = py.import("katt_ai.chat")?;
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

            let chat_module = py.import("katt_ai.chat")?;
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

            let chat_module = py.import("katt_ai.chat")?;
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

            let web_module = py.import("katt_ai.web_research")?;
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

            let web_module = py.import("katt_ai.web_research")?;
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

            let web_module = py.import("katt_ai.web_research")?;
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

            let inbox_module = py.import("katt_ai.inbox")?;
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

    // ===== Document Conversion (markitdown) =====

    /// Convert a document to Markdown using markitdown
    pub fn convert_document(&self, file_path: String) -> Result<DocumentConversionResult> {
        Python::attach(|py| {
            self.setup_python_path(py)?;

            let doc_module = py.import("katt_ai.document_convert")?;
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

            let doc_module = py.import("katt_ai.document_convert")?;
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

            let doc_module = py.import("katt_ai.document_convert")?;
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

            let doc_module = py.import("katt_ai.document_convert")?;
            let is_supported_fn = doc_module.getattr("is_supported_file_sync")?;

            let kwargs = PyDict::new(py);
            kwargs.set_item("file_path", file_path)?;

            let result = is_supported_fn.call((), Some(&kwargs))?;
            let is_supported: bool = result.extract()?;

            Ok(is_supported)
        })
    }
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
