"""MCP (Model Context Protocol) client for managing external tool servers."""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from katt_ai.models import (
    MCPServerConfig,
    MCPServersConfig,
    MCPTool,
    MCPToolResult,
)

logger = logging.getLogger(__name__)


class MCPServerConnection:
    """Represents a connection to a single MCP server."""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.session: ClientSession | None = None
        self._read: Any = None
        self._write: Any = None
        self._context_manager: Any = None
        self._tools: list[MCPTool] = []

    @property
    def is_connected(self) -> bool:
        return self.session is not None

    async def connect(self) -> bool:
        """Connect to the MCP server."""
        if self.is_connected:
            return True

        try:
            server_params = StdioServerParameters(
                command=self.config.command,
                args=self.config.args,
                env=self.config.env if self.config.env else None,
            )

            # Create the stdio client context manager
            self._context_manager = stdio_client(server_params)
            self._read, self._write = await self._context_manager.__aenter__()

            # Create and initialize the session
            self.session = ClientSession(self._read, self._write)
            await self.session.__aenter__()
            await self.session.initialize()

            # Cache available tools
            await self._refresh_tools()

            logger.info(f"Connected to MCP server: {self.config.name}")
            return True

        except Exception as e:
            logger.error(f"Failed to connect to MCP server {self.config.name}: {e}")
            await self.disconnect()
            return False

    async def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        if self.session:
            try:
                await self.session.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing session for {self.config.name}: {e}")
            self.session = None

        if self._context_manager:
            try:
                await self._context_manager.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing context for {self.config.name}: {e}")
            self._context_manager = None

        self._read = None
        self._write = None
        self._tools = []
        logger.info(f"Disconnected from MCP server: {self.config.name}")

    async def _refresh_tools(self) -> None:
        """Refresh the list of available tools from the server."""
        if not self.session:
            return

        try:
            result = await self.session.list_tools()
            self._tools = [
                MCPTool(
                    server_name=self.config.name,
                    name=tool.name,
                    description=tool.description,
                    input_schema=tool.inputSchema if hasattr(tool, "inputSchema") else {},
                )
                for tool in result.tools
            ]
        except Exception as e:
            logger.error(f"Failed to list tools from {self.config.name}: {e}")
            self._tools = []

    def get_tools(self) -> list[MCPTool]:
        """Get cached tools from this server."""
        return self._tools

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> MCPToolResult:
        """Call a tool on this server."""
        if not self.session:
            return MCPToolResult(
                server_name=self.config.name,
                tool_name=tool_name,
                success=False,
                content=None,
                error="Server not connected",
            )

        try:
            result = await self.session.call_tool(tool_name, arguments)

            # Extract content from the result
            content: Any = None
            if result.content:
                # MCP returns a list of content blocks
                content_parts = []
                for block in result.content:
                    if hasattr(block, "text"):
                        content_parts.append(block.text)
                    elif hasattr(block, "data"):
                        content_parts.append(block.data)
                content = "\n".join(str(p) for p in content_parts) if content_parts else None

            return MCPToolResult(
                server_name=self.config.name,
                tool_name=tool_name,
                success=not result.isError if hasattr(result, "isError") else True,
                content=content,
                error=None,
            )

        except Exception as e:
            logger.error(f"Error calling tool {tool_name} on {self.config.name}: {e}")
            return MCPToolResult(
                server_name=self.config.name,
                tool_name=tool_name,
                success=False,
                content=None,
                error=str(e),
            )


class MCPServerManager:
    """Manages multiple MCP server connections for a library."""

    def __init__(self, config_path: Path):
        """Initialize the manager with the path to the config file.

        Args:
            config_path: Path to the library directory where mcp_servers.json is stored
        """
        self.config_path = config_path / "mcp_servers.json"
        self._connections: dict[str, MCPServerConnection] = {}
        self._config: MCPServersConfig | None = None

    async def load_config(self) -> MCPServersConfig:
        """Load MCP server configuration from file."""
        if self.config_path.exists():
            try:
                with open(self.config_path) as f:
                    data = json.load(f)
                self._config = MCPServersConfig.model_validate(data)
            except Exception as e:
                logger.error(f"Failed to load MCP config: {e}")
                self._config = MCPServersConfig()
        else:
            self._config = MCPServersConfig()

        return self._config

    async def save_config(self, config: MCPServersConfig) -> None:
        """Save MCP server configuration to file."""
        self._config = config
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w") as f:
            json.dump(config.model_dump(), f, indent=2)

    async def start_server(self, server_config: MCPServerConfig) -> bool:
        """Start a connection to an MCP server."""
        if not server_config.enabled:
            return False

        if server_config.name in self._connections:
            existing = self._connections[server_config.name]
            if existing.is_connected:
                return True
            # Clean up old connection
            await existing.disconnect()

        connection = MCPServerConnection(server_config)
        success = await connection.connect()

        if success:
            self._connections[server_config.name] = connection

        return success

    async def stop_server(self, server_name: str) -> None:
        """Stop a specific MCP server connection."""
        if server_name in self._connections:
            await self._connections[server_name].disconnect()
            del self._connections[server_name]

    async def stop_all(self) -> None:
        """Stop all MCP server connections."""
        for name in list(self._connections.keys()):
            await self.stop_server(name)

    async def start_all_enabled(self) -> list[str]:
        """Start all enabled servers from config.

        Returns list of successfully started server names.
        """
        if not self._config:
            await self.load_config()

        started = []
        for server_config in self._config.servers:
            if server_config.enabled and await self.start_server(server_config):
                started.append(server_config.name)

        return started

    def get_running_servers(self) -> list[str]:
        """Get list of currently running server names."""
        return [name for name, conn in self._connections.items() if conn.is_connected]

    async def get_all_tools(self) -> list[MCPTool]:
        """Get all tools from all connected servers."""
        tools = []
        for connection in self._connections.values():
            if connection.is_connected:
                tools.extend(connection.get_tools())
        return tools

    async def call_tool(
        self, server_name: str, tool_name: str, arguments: dict[str, Any]
    ) -> MCPToolResult:
        """Call a tool on a specific server."""
        if server_name not in self._connections:
            return MCPToolResult(
                server_name=server_name,
                tool_name=tool_name,
                success=False,
                content=None,
                error=f"Server '{server_name}' not found or not running",
            )

        connection = self._connections[server_name]
        if not connection.is_connected:
            return MCPToolResult(
                server_name=server_name,
                tool_name=tool_name,
                success=False,
                content=None,
                error=f"Server '{server_name}' is not connected",
            )

        return await connection.call_tool(tool_name, arguments)


# Global manager instances per library path
_managers: dict[str, MCPServerManager] = {}


def get_manager(library_path: str) -> MCPServerManager:
    """Get or create an MCP manager for a library path."""
    if library_path not in _managers:
        _managers[library_path] = MCPServerManager(Path(library_path))
    return _managers[library_path]


# ===== Synchronous wrappers for PyO3 =====


def mcp_load_config_sync(library_path: str) -> dict:
    """Load MCP server configuration (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    config = asyncio.run(manager.load_config())
    return config.model_dump()


def mcp_save_config_sync(library_path: str, config_dict: dict) -> None:
    """Save MCP server configuration (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    config = MCPServersConfig.model_validate(config_dict)
    asyncio.run(manager.save_config(config))


def mcp_start_servers_sync(library_path: str) -> list[str]:
    """Start all enabled MCP servers (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    return asyncio.run(manager.start_all_enabled())


def mcp_stop_servers_sync(library_path: str) -> None:
    """Stop all MCP servers (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    asyncio.run(manager.stop_all())


def mcp_get_tools_sync(library_path: str) -> list[dict]:
    """Get all tools from running MCP servers (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    tools = asyncio.run(manager.get_all_tools())
    return [tool.model_dump() for tool in tools]


def mcp_call_tool_sync(
    library_path: str, server_name: str, tool_name: str, arguments: dict
) -> dict:
    """Call a tool on an MCP server (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    result = asyncio.run(manager.call_tool(server_name, tool_name, arguments))
    return result.model_dump()


def mcp_get_running_servers_sync(library_path: str) -> list[str]:
    """Get list of running server names (sync wrapper for PyO3)."""
    manager = get_manager(library_path)
    return manager.get_running_servers()
