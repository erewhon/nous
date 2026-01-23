//! MCP (Model Context Protocol) server management commands.

use tauri::State;

use crate::python_bridge::{MCPServerConfig, MCPServersConfig, MCPTool, MCPToolResult};
use crate::AppState;

use super::notebook::CommandError;

/// Load MCP server configuration for the current library
#[tauri::command]
pub fn mcp_load_config(state: State<AppState>) -> Result<MCPServersConfig, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_load_config(&current_library.path.to_string_lossy())
        .map_err(|e| CommandError {
            message: format!("Failed to load MCP config: {}", e),
        })
}

/// Save MCP server configuration for the current library
#[tauri::command]
pub fn mcp_save_config(
    state: State<AppState>,
    config: MCPServersConfig,
) -> Result<(), CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_save_config(&current_library.path.to_string_lossy(), config)
        .map_err(|e| CommandError {
            message: format!("Failed to save MCP config: {}", e),
        })
}

/// Start all enabled MCP servers for the current library
#[tauri::command]
pub fn mcp_start_servers(state: State<AppState>) -> Result<Vec<String>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_start_servers(&current_library.path.to_string_lossy())
        .map_err(|e| CommandError {
            message: format!("Failed to start MCP servers: {}", e),
        })
}

/// Stop all MCP servers for the current library
#[tauri::command]
pub fn mcp_stop_servers(state: State<AppState>) -> Result<(), CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_stop_servers(&current_library.path.to_string_lossy())
        .map_err(|e| CommandError {
            message: format!("Failed to stop MCP servers: {}", e),
        })
}

/// Get all tools from running MCP servers
#[tauri::command]
pub fn mcp_get_tools(state: State<AppState>) -> Result<Vec<MCPTool>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_get_tools(&current_library.path.to_string_lossy())
        .map_err(|e| CommandError {
            message: format!("Failed to get MCP tools: {}", e),
        })
}

/// Get list of running MCP server names
#[tauri::command]
pub fn mcp_get_running_servers(state: State<AppState>) -> Result<Vec<String>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_get_running_servers(&current_library.path.to_string_lossy())
        .map_err(|e| CommandError {
            message: format!("Failed to get running MCP servers: {}", e),
        })
}

/// Call a tool on an MCP server
#[tauri::command]
pub fn mcp_call_tool(
    state: State<AppState>,
    server_name: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<MCPToolResult, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let library_storage = state.library_storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire library storage lock: {}", e),
    })?;

    let current_library = library_storage.get_current().map_err(|e| CommandError {
        message: format!("Failed to get current library: {}", e),
    })?;

    python_ai
        .mcp_call_tool(
            &current_library.path.to_string_lossy(),
            &server_name,
            &tool_name,
            arguments,
        )
        .map_err(|e| CommandError {
            message: format!("Failed to call MCP tool: {}", e),
        })
}
