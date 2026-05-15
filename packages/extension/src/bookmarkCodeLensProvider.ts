import * as vscode from 'vscode';
import { readRegistry, type Bookmark } from '@agentic-bookmarks/core';

/**
 * Provides CodeLens decorations for bookmark labels and notes.
 * Creates multiple stacked CodeLens items for long text.
 */
export class BookmarkCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(
    private workspaceRoot: string,
    private getBookmarksForUri: (uri: string) => Promise<Bookmark[]>,
    private isNoteVisible: (bookmarkId: string) => boolean
  ) {}

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(  // @bookmark:hbT8EV
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    // Check if feature is enabled
    const reg = await readRegistry(this.workspaceRoot);
    if (reg.settings?.general?.showNotesAndLabels === false) {
      return [];
    }

    // Get bookmarks for this document
    const bookmarks = await this.getBookmarksForUri(document.uri.toString());
    if (!bookmarks || bookmarks.length === 0) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];

    for (const bookmark of bookmarks) { // @bookmark:eibXlwV4
      // Skip bookmarks without notes — no CodeLens needed
      if (!bookmark.note || bookmark.note.trim() === '') continue;

      const line = bookmark.anchor.kind === 'point'
        ? bookmark.anchor.line
        : bookmark.anchor.kind === 'range'
        ? bookmark.anchor.start.line
        : bookmark.anchor.lastUpdatedLine;

      // Create a range for the code lens (0-based line number)
      const range = new vscode.Range(line, 0, line, 0);

      // Show only a dot to create vertical space
      // The actual content will be shown via decorations
      const codeLens = new vscode.CodeLens(range, {
        title: '·',  // Middle dot character for minimal visual noise
        command: '', // No command, just display
        tooltip: `${bookmark.label || ''}\n\n${bookmark.note || ''}`.trim()
      });

      codeLenses.push(codeLens);

      const visible = this.isNoteVisible(bookmark.id);
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: visible ? 'hide note' : 'show note',
          command: 'agenticBookmarks.toggleBookmarkNoteVisibility',
          arguments: [bookmark.id],
          tooltip: visible ? 'Hide this bookmark note' : 'Show this bookmark note'
        })
      );
    }

    return codeLenses;
  }
}
