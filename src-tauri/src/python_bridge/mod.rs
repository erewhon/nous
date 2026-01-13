//! Python bridge module for AI operations via PyO3.

use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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
            })
        })
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
