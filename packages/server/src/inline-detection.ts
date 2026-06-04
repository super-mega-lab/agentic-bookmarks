/**
 * Inline Detection — recognize when a deleted construct (setter / getter /
 * method / utility function) was *inlined*: its declaration removed and its body
 * substituted at a call site within the same file.
 *
 * Pure analysis over diff data — no async, no git, no file I/O. Used by
 * handleGetFileDiff to upgrade a bare `no_match` diagnosis to `inlined`, pointing
 * the repair agent at the call site(s). See docs/plans/SML-1465.md for the full
 * heuristic. Deliberately conservative: false positives mislead the agent, so the
 * detector returns null whenever the evidence is ambiguous.
 */

import type { gitHistory } from '@agentic-bookmarks/core';

type FileDiff = gitHistory.FileDiff;
type DiffHunk = gitHistory.DiffHunk;

export interface InlinedCallSite {
  /** 0-based line in the current file where the body was substituted. */
  line: number;
  content: string;
}

export interface InlinedDetail {
  anchorLineModified: true;
  deletedSymbol: string;
  deletedBody: string;
  inlinedAt: { line: number; content: string; confidence: 'medium' | 'low' };
  /** All detected call sites, ordered by line. `inlinedAt` === candidates[0]. */
  candidates: InlinedCallSite[];
  explanation: string;
}

export interface InlinedDiagnosis {
  diagnosis: 'inlined';
  detail: InlinedDetail;
}

type DeclKind = 'setter' | 'getter' | 'method' | 'function' | 'arrow';

interface ParsedDeclaration {
  symbol: string;
  paramNames: string[];
  kind: DeclKind;
}

// Identifiers that look like a method declaration `name(...) {` but are control
// flow / keywords, not a method. The method regex would otherwise capture them.
const METHOD_KEYWORD_BLOCKLIST = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'await',
  'do', 'else', 'with', 'new', 'typeof', 'in', 'of', 'case', 'yield', 'void',
  'delete', 'throw', 'super',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a trimmed source line into a construct declaration, or null if it is not
 * one. Recognizes setters, getters, functions, const-arrow functions, and class
 * methods (with a keyword blocklist so control flow isn't mistaken for a method).
 */
export function parseDeclaration(content: string): ParsedDeclaration | null {
  const t = content.trim();

  let m = /^(?:(?:public|private|protected|static|readonly|abstract|override)\s+)*set\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(t);
  if (m) return { symbol: m[1], paramNames: parseParams(m[2]), kind: 'setter' };

  m = /^(?:(?:public|private|protected|static|readonly|abstract|override)\s+)*get\s+([A-Za-z_$][\w$]*)\s*\(\s*\)/.exec(t);
  if (m) return { symbol: m[1], paramNames: [], kind: 'getter' };

  m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(t);
  if (m) return { symbol: m[1], paramNames: parseParams(m[2]), kind: 'function' };

  m = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/.exec(t);
  if (m) return { symbol: m[1], paramNames: parseParams(m[2]), kind: 'arrow' };

  // Class method: [modifiers] name(params) [: ret] {  — last, and keyword-guarded.
  m = /^(?:(?:public|private|protected|static|async|readonly|abstract|override)\s+)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*[^={]+)?\{?\s*$/.exec(t);
  if (m && !METHOD_KEYWORD_BLOCKLIST.has(m[1])) {
    return { symbol: m[1], paramNames: parseParams(m[2]), kind: 'method' };
  }

  return null;
}

/** Extract bare parameter identifiers (drops types, defaults, modifiers, destructuring). */
function parseParams(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map(p => {
      const dm = /^(?:public\s+|private\s+|protected\s+|readonly\s+)*\.{0,3}([A-Za-z_$][\w$]*)/.exec(p.trim());
      return dm ? dm[1] : '';
    })
    .filter(Boolean);
}

export function isBraceOnly(t: string): boolean {
  return t === '{' || t === '}' || t === '};' || t === '})' || t === '});' || t === ')' || t === '),';
}

export function isCommentOnly(t: string): boolean {
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t === '*/';
}

/**
 * From the deletion lines that follow a declaration within its hunk, extract the
 * single meaningful body statement. Returns null unless there is exactly one
 * (multi-statement / complex bodies are out of scope). For value-returning forms
 * (`return EXPR;`) the leading `return` is stripped and `isExpression` is set.
 */
function extractBody(
  hunk: DiffHunk,
  declIndex: number,
): { bodyExpr: string; isExpression: boolean } | null {
  const bodyLines: string[] = [];
  for (let i = declIndex + 1; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (line.type !== 'deletion') break; // deletion run ended
    const t = line.content.trim();
    if (isBraceOnly(t)) break; // reached the construct's closing brace
    bodyLines.push(t);
  }

  const meaningful = bodyLines.filter(t => t !== '' && !isBraceOnly(t) && !isCommentOnly(t));
  if (meaningful.length !== 1) return null;

  let bodyExpr = meaningful[0];
  let isExpression = false;
  const rm = /^return\s+(.+?);?$/.exec(bodyExpr);
  if (rm) {
    bodyExpr = rm[1].trim();
    isExpression = true;
  }
  return { bodyExpr, isExpression };
}

/** Reject generic bodies (e.g. `return x;`) that would match too much. */
export function bodyIsSpecific(bodyExpr: string, paramNames: string[]): boolean {
  let skeleton = bodyExpr;
  for (const p of paramNames) {
    skeleton = skeleton.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, 'g'), '');
  }
  const compact = skeleton.replace(/[\s;{}()]/g, '');
  if (compact.length < 6) return false;
  return /[.=(]/.test(bodyExpr);
}

/**
 * Does `candidate` hold `bodyExpr`, allowing each parameter name to be replaced
 * by any identifier (call-site argument renaming)? Statement bodies must match
 * the whole line; expression bodies (from `return`) may match as a substring.
 */
function bodyMatches(
  bodyExpr: string,
  paramNames: string[],
  isExpression: boolean,
  candidate: string,
): boolean {
  const b = bodyExpr.trim();
  const c = candidate.trim();

  if (!isExpression) {
    if (c === b) return true;
    if (paramNames.length === 0) return false; // exact-only when nothing to vary
    const re = buildTemplate(b, paramNames, true);
    return re ? re.test(c) : false;
  }

  if (c.includes(b)) return true;
  if (paramNames.length === 0) return false;
  const re = buildTemplate(b, paramNames, false);
  return re ? re.test(c) : false;
}

export function buildTemplate(body: string, paramNames: string[], anchored: boolean): RegExp | null {
  let pattern = escapeRegExp(body);
  for (const p of paramNames) {
    pattern = pattern.replace(new RegExp(`\\b${escapeRegExp(p)}\\b`, 'g'), '[A-Za-z_$][\\w$.]*');
  }
  try {
    return new RegExp(anchored ? `^${pattern}$` : pattern);
  } catch {
    return null;
  }
}

/** True if a hunk has a deletion line (other than the declaration) that uses `symbol`. */
function hunkHasSymbolUseDeletion(hunk: DiffHunk, symbol: string, declIndex: number): boolean {
  const useRe = new RegExp(`(?:\\.|\\b)${escapeRegExp(symbol)}\\b`);
  for (let i = 0; i < hunk.lines.length; i++) {
    if (i === declIndex) continue;
    const line = hunk.lines[i];
    if (line.type !== 'deletion') continue;
    if (parseDeclaration(line.content)) continue; // skip other declaration lines
    if (useRe.test(line.content)) return true;
  }
  return false;
}

/** Is the deleted declaration the construct this anchor pointed at? */
export function declTiedToAnchor(
  anchor: { lineCache?: string; lastUpdatedLine: number },
  declContent: string,
  bodyDeletionLines: string[],
  symbol: string,
  hunk: DiffHunk,
): boolean {
  const lc = (anchor.lineCache ?? '').trim();
  if (lc) {
    if (declContent.trim() === lc) return true;
    if (bodyDeletionLines.some(l => l.trim() === lc)) return true;
    return new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(lc);
  }
  // No lineCache (e.g. point anchor): fall back to position. lastUpdatedLine is
  // 0-based; hunk.oldStart is 1-based.
  const oldLine1 = anchor.lastUpdatedLine + 1;
  return oldLine1 >= hunk.oldStart && oldLine1 < hunk.oldStart + hunk.oldCount;
}

export function kindLabel(kind: DeclKind): string {
  switch (kind) {
    case 'setter': return 'Setter';
    case 'getter': return 'Getter';
    case 'method': return 'Method';
    default: return 'Function';
  }
}

/**
 * Detect whether the anchor's deleted construct was inlined at one or more call
 * sites in the same file's diff. Returns an `inlined` diagnosis, or null when the
 * pattern does not hold (caller keeps the original `no_match`).
 */
export function detectInlinedConstruct(
  anchor: { lineCache?: string; lastUpdatedLine: number },
  diff: FileDiff,
  currentFileLines: string[],
): InlinedDiagnosis | null {
  if (!diff || !diff.hunks || diff.hunks.length === 0) return null;

  // Find a deleted declaration tied to the anchor that yields >= 1 call site.
  for (let h = 0; h < diff.hunks.length; h++) {
    const hunk = diff.hunks[h];
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (line.type !== 'deletion') continue;

      const decl = parseDeclaration(line.content);
      if (!decl) continue;

      const body = extractBody(hunk, i);
      if (!body) continue;

      // Bound the body to THIS construct: stop at the first brace-only line (its
      // closing brace), the same bound merged-detection uses. Without it, a sibling
      // construct's deletion lines leak into bodyDeletionLines and could falsely tie
      // an unrelated declaration to the anchor. (SML-1568)
      const bodyDeletionLines: string[] = [];
      for (let j = i + 1; j < hunk.lines.length; j++) {
        const bl = hunk.lines[j];
        if (bl.type !== 'deletion') break;
        if (isBraceOnly(bl.content.trim())) break;
        bodyDeletionLines.push(bl.content);
      }

      if (!declTiedToAnchor(anchor, line.content, bodyDeletionLines, decl.symbol, hunk)) continue;
      if (!bodyIsSpecific(body.bodyExpr, decl.paramNames)) continue;

      // Scan every hunk for call-site substitutions of this construct.
      const candidates: InlinedCallSite[] = [];
      const seen = new Set<number>();
      for (let hh = 0; hh < diff.hunks.length; hh++) {
        const scanHunk = diff.hunks[hh];
        const declIndex = hh === h ? i : -1;
        if (!hunkHasSymbolUseDeletion(scanHunk, decl.symbol, declIndex)) continue;

        for (const cand of scanHunk.lines) {
          if (cand.type !== 'addition' || cand.newLineNumber === undefined) continue;
          if (!bodyMatches(body.bodyExpr, decl.paramNames, body.isExpression, cand.content)) continue;
          const line0 = cand.newLineNumber - 1;
          // SML-1556: cand.newLineNumber is HEAD-relative (the diff is fromCommit ->
          // HEAD) but currentFileLines is the working tree. If the working tree has
          // drifted at this row (uncommitted edits above the call site), line0 indexes
          // the wrong line and the reported line/content would disagree — distrust the
          // position rather than point at a bogus call site. An absent row (out of
          // range, or the pure-diff [] usage) keeps the recorded addition as fallback.
          const current = currentFileLines[line0];
          if (current !== undefined && current !== cand.content) continue;
          if (seen.has(line0)) continue;
          seen.add(line0);
          // Report the line as it stands in the current file (the source of truth
          // the agent will open); fall back to the diff's recorded addition.
          candidates.push({ line: line0, content: current ?? cand.content });
        }
      }

      if (candidates.length === 0) continue;

      candidates.sort((a, b) => a.line - b.line);
      const confidence: 'medium' | 'low' = candidates.length === 1 ? 'medium' : 'low';
      const n = candidates.length;

      return {
        diagnosis: 'inlined',
        detail: {
          anchorLineModified: true,
          deletedSymbol: decl.symbol,
          deletedBody: body.bodyExpr,
          inlinedAt: { line: candidates[0].line, content: candidates[0].content, confidence },
          candidates,
          explanation: `${kindLabel(decl.kind)} body was inlined at ${n} call site${n === 1 ? '' : 's'} in the same commit; ${confidence} confidence`,
        },
      };
    }
  }

  return null;
}
