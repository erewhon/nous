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
