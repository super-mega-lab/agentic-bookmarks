// ABOUTME: Tests for the Agents panel HTML renderer.
import { describe, it, expect } from 'vitest';
import { renderAgentsHtml, SKILLS } from './agentsHtml';

describe('renderAgentsHtml', () => {
  const html = renderAgentsHtml({ cspSource: 'https://test.vscode', nonce: 'abc123' });

  it('returns a complete HTML document', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes the CSP with the provided source and nonce', () => {
    expect(html).toContain('https://test.vscode');
    expect(html).toContain('abc123');
  });

  it('renders a pill button for every skill', () => {
    for (const skill of SKILLS) {
      expect(html).toContain(skill.label);
      expect(html).toContain(`codicon-${skill.icon}`);
    }
  });

  it('renders command URIs with the skill id', () => {
    for (const skill of SKILLS) {
      expect(html).toContain(encodeURIComponent(JSON.stringify([skill.id])));
    }
  });

  it('has exactly 6 skill pills', () => {
    expect(SKILLS).toHaveLength(6);
  });
});
