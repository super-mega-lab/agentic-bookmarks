// ABOUTME: Pure helpers for building the 'claude mcp add' setup command string.
// ABOUTME: Extracted for testability — no VS Code API dependencies.

// Quote a value for POSIX shell (single-quote style).
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds the terminal command string for setting up the agentic-bookmarks
 * MCP server in Claude Code. Removes from both local and user scopes first
 * so re-runs and scope switches succeed without a "already exists" error.
 *
 * @param scope      'local' (project-only) or 'user' (all projects)
 * @param serverPath Absolute path to server-bundle/index.js
 * @param bookmarksDir Absolute path to .bookmarks/local for local scope; ignored for user scope
 */
export function buildClaudeMcpSetupCommand(
  scope: 'local' | 'user',
  serverPath: string,
  bookmarksDir: string,
): string {
  const envFlags =
    scope === 'local'
      ? `--env ${shellQuote(`BOOKMARKS_DIR=${bookmarksDir}`)}`
      : '--env BOOKMARKS_DIR= --env BOOKMARKS_UPWARD_DISCOVERY=true';

  return (
    `claude mcp remove agentic_bookmarks --scope local 2>/dev/null; ` +
    `claude mcp remove agentic_bookmarks --scope user 2>/dev/null; ` +
    `claude mcp add --transport stdio ${envFlags} --scope ${scope} ` +
    `agentic_bookmarks -- node ${shellQuote(serverPath)}`
  );
}
