export const toolDefinitions = [
  {
    name: 'bookmark_add',
    description: `Add a bookmark to a code location.

USE 'groupName' TO ORGANIZE BOOKMARKS - groups are automatically created if they don't exist.

Lines are 1-based.

Parameters:
- uri (required): File URI to bookmark (e.g., "file:///path/to/file.ts")
- groupName (recommended): Descriptive name for the bookmark group (e.g., "API Endpoints", "Bug Fixes", "Architecture")
- anchor (required): Location - either {kind: "point", line: N} or {kind: "range", start: {line: N}, end: {line: M}}
- label (required): Short description of the bookmark (can be empty string)
- note (optional): Longer notes about this location
- tags (optional): Array of tags for categorization

Group names are unique per workspace. The same group name in different workspaces creates separate groups.
You do NOT need to manage files or IDs - just provide groupName and the MCP server handles the rest.

Example:
{
  "uri": "file:///Users/dev/project/src/api/users.ts",
  "groupName": "User Authentication",
  "anchor": {"kind": "point", "line": 42},
  "label": "Login endpoint handler"
}

For guidance on bookmarking a system or set of files, read bookmarks://skill/add-to-system or bookmarks://skill/add-to-files.`,
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Full file:// URI to the file to bookmark (must be within a workspace)',
        },
        groupName: {
          type: 'string',
          description: 'Name of the group to add to (e.g., "API Endpoints", "Bug Fixes"). Auto-created if it does not exist. Recommended over groupId.',
        },
        anchor: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { const: 'point' },
                line: { type: 'number', description: '1-based (matches editor / grep -n)' },
                column: { type: 'number', description: '0-based column (optional)' },
                lineCache: { type: 'string', description: 'Cached line content (optional)' },
              },
              required: ['kind', 'line'],
            },
            {
              type: 'object',
              properties: {
                kind: { const: 'range' },
                start: {
                  type: 'object',
                  properties: {
                    line: { type: 'number', description: '1-based line number' },
                    column: { type: 'number', description: '0-based column (optional)' },
                  },
                  required: ['line'],
                },
                end: {
                  type: 'object',
                  properties: {
                    line: { type: 'number', description: '1-based line number' },
                    column: { type: 'number', description: '0-based column (optional)' },
                  },
                  required: ['line'],
                },
                lineCache: { type: 'string' },
              },
              required: ['kind', 'start', 'end'],
            },
            { type: 'number', description: 'Just a 1-based line number' }
          ],
          description: 'Anchor position - point {kind: "point", line: N}, range {kind: "range", start: {line: N}, end: {line: M}}, or just a line number. Lines are 1-based.',
        },
        label: {
          type: 'string',
          description: 'Short label for the bookmark (can be empty string)',
        },
        note: {
          type: 'string',
          description: 'Optional longer note/description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
        anchorType: {
          type: 'string',
          enum: ['point', 'range', 'smart', 'tag'],
          description: 'Anchor type to use (default: uses workspace setting)',
        },
        // Legacy support - hidden from main description
        groupId: {
          type: 'string',
          description: 'Direct group ID (legacy - prefer groupName instead)',
        },
        newGroupName: {
          type: 'string',
          description: 'Deprecated alias for groupName',
        },
      },
      required: ['uri', 'label', 'anchor']
    }
  },
  {
    name: 'bookmark_list',
    description: 'List bookmarks with optional filters (query, groupId, fileId). Query matches bookmark ID, label, note, lineCache, URI, or tags. Fetch "bookmarks://files" for list of available groups/files to filter by. Anchor lines in the response are 1-based.\n\nTo derive insights from existing bookmarks, read bookmarks://skill/analyze. If no bookmarks exist yet, consider bookmarks://skill/map-codebase to build an initial map.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search query' },
        groupId: { type: 'string', description: 'Filter by group id (within file or across files)' },
        fileId: { type: 'string', description: 'Filter by file id (limits the search to one file)' }
      }
    }
  },
  {
    name: 'bookmark_delete',
    description: 'Delete a bookmark by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the bookmark to delete' }
      },
      required: ['id']
    }
  },
  {
    name: 'bookmark_open',
    description: 'Open a bookmark (returns the URI). Anchor lines in the response are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the bookmark to open' }
      },
      required: ['id']
    }
  },
  {
    name: 'mcp_debug',
    description: 'Debug helper: report server version, env flags, and active workspaces.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },
  { name: 'file_create', description: 'Create a new v2 bookmarks file and register it. Returns the created fileId.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' } }, required: ['path'] } },
  { name: 'file_register', description: 'Register an existing bookmarks file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' } }, required: ['path'] } },
  { name: 'file_deregister', description: 'Deregister a bookmarks file (only on explicit user request)', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  {
    name: 'group_create',
    description: 'Explicitly create a new group. Note: Groups are auto-created when using bookmark_add with groupName, so this is rarely needed. Use this only when you need to create an empty group upfront. Group names must be unique within the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'File ID to create group in' },
        filePath: { type: 'string', description: 'File path to create group in (alternative to fileId)' },
        name: { type: 'string', description: 'Name for the new group (must be unique in workspace)' }
      },
      required: ['name']
    }
  },
  { name: 'group_rename', description: 'Rename a group by its ID (global uniqueness enforced)', inputSchema: { type: 'object', properties: { groupId: { type: 'string', description: 'ID of the group to rename' }, newName: { type: 'string', description: 'New name for the group' } }, required: ['groupId', 'newName'] } },
  { name: 'group_moveFile', description: 'Move a group to another file', inputSchema: { type: 'object', properties: { sourceFile: { type: 'string' }, destFile: { type: 'string' }, groupId: { type: 'string' } }, required: ['sourceFile', 'destFile', 'groupId'] } },
  { name: 'group_delete', description: 'Delete or clear a group from a file', inputSchema: { type: 'object', properties: { filePath: { type: 'string' }, groupId: { type: 'string' } }, required: ['filePath', 'groupId'] } },
  {
    name: 'bookmark_search',
    description: 'Search bookmarks across all enabled files by text/tags/group/file/createdAt with configurable output format. Check resource "bookmarks://mode" for user preference on search proactivity. Fetch "bookmarks://files" for list of available groups/files. Lines in the response are 1-based.\n\nTo derive insights from existing bookmarks, read bookmarks://skill/analyze. If no bookmarks exist yet, consider bookmarks://skill/map-codebase to build an initial map.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Search text (searches label, note, lineCache, uri)' },
        groupName: { type: 'string', description: 'Filter by group name' },
        tag: { type: 'string', description: 'Filter by tag' },
        filePathContains: { type: 'string', description: 'Filter by file path substring' },
        before: { type: 'number', description: 'Filter by created before timestamp' },
        after: { type: 'number', description: 'Filter by created after timestamp' },
        resultsMode: {
          type: 'string',
          enum: ['textual', 'lineNumbers', 'full'],
          description: 'Output format: "textual" (uri+label+lineCache), "lineNumbers" (uri+line), "full" (complete bookmark objects). Default: "full"'
        }
      }
    }
  },
  { name: 'settings_setAppearance', description: 'Update appearance settings (uniform colors/styles and toggles)', inputSchema: { type: 'object', properties: { uniformColor: { type: 'string' }, uniformStyle: { type: 'string' }, showDifferentColors: { type: 'boolean' }, showDifferentStyles: { type: 'boolean' } } } },
  // 'style_catalog_setPath' was removed in SML-1320 (locked-down catalog surface).
  {
    name: 'self_test',
    description: 'Development tool for testing client/server communication. Only use when explicitly asked by user. Echo back test parameters to verify connection.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmark_mode: {
          type: 'string',
          description: 'Test parameter for bookmark mode (proactive, balanced, or reactive)'
        }
      },
      required: ['bookmark_mode']
    }
  },
  // === ANCHOR REPAIR TOOLS ===
  {
    name: 'anchor_validate',
    description: 'Validate bookmarks in a file against current content. Returns validation status for each anchor including error details for broken anchors. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'File URI to validate bookmarks for',
        },
      },
      required: ['uri'],
    },
  },
  {
    name: 'anchor_getRepairPackage',
    description: 'Get repair context for broken anchors. Returns anchor data, bookmark metadata (label/note/tags for supplemental disambiguation), validation errors, and surrounding file content for each broken anchor. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'File URI containing broken anchors',
        },
        bookmarkIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of bookmark IDs to get repair packages for. If omitted, returns packages for all broken anchors.',
        },
        includeHints: {
          type: 'boolean',
          description: 'Include optional smart-anchor diagnostics (score breakdown and closest-context windows). Default: false.',
        },
        hintWindowRadius: {
          type: 'number',
          description: 'Radius for hint windows around closest candidates. Default: 8, range: 2-30.',
        },
      },
      required: ['uri'],
    },
  },
  {
    name: 'anchor_repair',
    description: 'Apply repairs to broken anchors by rebuilding anchors at new line positions. Handles smart, tag, and point anchor types. Tag repairs return instructions for the agent to update source file comments. Supports cross-file repairs via optional newUri parameter for file moves. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        repairs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              bookmarkId: { type: 'string' },
              newLine: { type: 'number', description: '1-based (matches editor / grep -n)' },
              newUri: {
                type: 'string',
                description: 'Optional new file URI for cross-file repairs (file moves). When provided, the bookmark target is retargeted to this file and the anchor is rebuilt there.',
              },
            },
            required: ['bookmarkId', 'newLine'],
          },
          description: 'Array of repairs to apply',
        },
      },
      required: ['repairs'],
    },
  },
  // === ANCHOR GIT REPAIR TOOLS (Phase 2) ===
  {
    name: 'anchor_getHistoricalContext',
    description: 'Show code at the time an anchor was last valid. Returns historical file content around the anchor position with commit info.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: { type: 'string', description: 'Bookmark ID to get historical context for' },
      },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'anchor_getFileDiff',
    description: 'Diagnose what happened to an anchor\'s code. Returns structured diagnosis: shifted (line moved), exact_match, fuzzy_match, signature_changed (same function/method, refactored declaration — repair at detail.newLine), or no_match with full diff. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: { type: 'string', description: 'Bookmark ID to diagnose' },
      },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'anchor_searchMovedCode',
    description: 'Search for anchor content in other files that changed since the anchor was placed. Detects cross-file code movement. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: { type: 'string', description: 'Bookmark ID to search for' },
      },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'anchor_traceLineHistory',
    description: 'Mechanically trace a line through commit-by-commit patches. Shows where the line ended up or where it was lost. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        bookmarkId: { type: 'string', description: 'Bookmark ID to trace' },
      },
      required: ['bookmarkId'],
    },
  },
  {
    name: 'anchor_readFileAtRevision',
    description: 'Read a section of a file at a specific git commit. Supports line range or search text. Lines (input and response) are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file (relative to repo root)' },
        commit: { type: 'string', description: 'Git commit SHA or ref' },
        startLine: { type: 'number', description: '1-based line number' },
        endLine: { type: 'number', description: '1-based line number' },
        searchText: { type: 'string', description: 'Search for text and center results on first match' },
      },
      required: ['filePath', 'commit'],
    },
  },
  {
    name: 'anchor_getCommitDiff',
    description: 'Inspect what a specific commit changed, optionally scoped to one file.',
    inputSchema: {
      type: 'object',
      properties: {
        commit: { type: 'string', description: 'Git commit SHA' },
        filePath: { type: 'string', description: 'Optional file path to scope diff to' },
      },
      required: ['commit'],
    },
  },
  {
    name: 'anchor_getLineLog',
    description: 'Find which commits touched a specific region of a file. Lines are 1-based.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file (relative to repo root)' },
        startLine: { type: 'number', description: '1-based line number' },
        endLine: { type: 'number', description: '1-based line number' },
        maxCommits: { type: 'number', description: 'Max commits to return (default 10)' },
      },
      required: ['filePath', 'startLine', 'endLine'],
    },
  },
  {
    name: 'anchor_getRepairSkillGuide',
    description: 'Get the anchor repair guide. Call once at the start of a repair session to learn the waterfall strategy and available tools.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'anchor_listBroken',
    description: 'List broken and low-confidence bookmarks. Cached entries are validated against the current file on read, so anchors repaired or edited clean since they were cached are evicted automatically. The response includes a coverage signal (covered vs total bookmarked files): when covered < total, some files have not been checked yet, so an empty result does not guarantee the whole repo is clean — use anchor_validate to check a specific file. Use this to see which anchors need attention before calling anchor_validate or anchor_getRepairPackage.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['broken', 'warning', 'all'],
          description: 'Filter by status. "broken" = unresolved anchors, "warning" = low-confidence matches, "all" = both. Default: "all".',
        },
      },
    },
  },
];
