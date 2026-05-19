// ABOUTME: Tests for MCP resource handlers — skill resources and existing resources.
// ABOUTME: Exercises handleListResources and handleReadResource for bookmarks://skill/* URIs.

import { describe, it, expect } from 'vitest';
import { handleListResources, handleReadResource } from './resource-handlers.js';

describe('handleListResources', () => {
  it('includes all four skill resources', async () => {
    const result = await handleListResources();
    const uris = result.resources.map(r => r.uri);
    expect(uris).toContain('bookmarks://skill/add-to-system');
    expect(uris).toContain('bookmarks://skill/add-to-files');
    expect(uris).toContain('bookmarks://skill/analyze');
    expect(uris).toContain('bookmarks://skill/map-codebase');
  });

  it('does not include a repair skill resource', async () => {
    const result = await handleListResources();
    const uris = result.resources.map(r => r.uri);
    expect(uris).not.toContain('bookmarks://skill/repair');
  });

  it('skill resources have text/markdown mimeType', async () => {
    const result = await handleListResources();
    const skillResources = result.resources.filter(r => r.uri.startsWith('bookmarks://skill/'));
    for (const r of skillResources) {
      expect(r.mimeType).toBe('text/markdown');
    }
  });
});

describe('handleReadResource — skill URIs', () => {
  const fakeCtx: any = { workspaceRoot: '/tmp', workspaces: [] };

  it('returns markdown content for bookmarks://skill/add-to-system', async () => {
    const result = await handleReadResource(fakeCtx, 'bookmarks://skill/add-to-system');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Add Bookmarks to a System');
  });

  it('returns markdown content for bookmarks://skill/add-to-files', async () => {
    const result = await handleReadResource(fakeCtx, 'bookmarks://skill/add-to-files');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Add Bookmarks to Files');
  });

  it('returns markdown content for bookmarks://skill/analyze', async () => {
    const result = await handleReadResource(fakeCtx, 'bookmarks://skill/analyze');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Analyze Bookmarks');
  });

  it('returns markdown content for bookmarks://skill/map-codebase', async () => {
    const result = await handleReadResource(fakeCtx, 'bookmarks://skill/map-codebase');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(result.contents[0].text).toContain('Map Codebase');
  });

  it('throws for unknown skill URI', async () => {
    await expect(handleReadResource(fakeCtx, 'bookmarks://skill/nonexistent'))
      .rejects.toThrow('Invalid resource URI');
  });

  it('throws for repair skill URI (not implemented)', async () => {
    await expect(handleReadResource(fakeCtx, 'bookmarks://skill/repair'))
      .rejects.toThrow('Invalid resource URI');
  });
});

import { toolDefinitions } from './tools/definitions.js';

describe('tool description discovery hints', () => {
  function getDesc(name: string) {
    return toolDefinitions.find(t => t.name === name)?.description ?? '';
  }

  it('bookmark_add includes add-to-system hint', () => {
    expect(getDesc('bookmark_add')).toContain('bookmarks://skill/add-to-system');
  });

  it('bookmark_add includes add-to-files hint', () => {
    expect(getDesc('bookmark_add')).toContain('bookmarks://skill/add-to-files');
  });

  it('bookmark_list includes analyze hint', () => {
    expect(getDesc('bookmark_list')).toContain('bookmarks://skill/analyze');
  });

  it('bookmark_list includes map-codebase hint', () => {
    expect(getDesc('bookmark_list')).toContain('bookmarks://skill/map-codebase');
  });

  it('bookmark_search includes analyze hint', () => {
    expect(getDesc('bookmark_search')).toContain('bookmarks://skill/analyze');
  });

  it('bookmark_search includes map-codebase hint', () => {
    expect(getDesc('bookmark_search')).toContain('bookmarks://skill/map-codebase');
  });

  it('anchor_listBroken does NOT include a skill hint', () => {
    expect(getDesc('anchor_listBroken')).not.toContain('bookmarks://skill/');
  });

  it('anchor_validate does NOT include a skill hint', () => {
    expect(getDesc('anchor_validate')).not.toContain('bookmarks://skill/');
  });
});
