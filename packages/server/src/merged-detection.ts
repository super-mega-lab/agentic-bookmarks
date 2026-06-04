/**
 * Merged-construct detection — recognize when a deleted construct (setter / getter
 * / method / function) was *merged* into another method or function: its
 * declaration removed and its body combined into a method that was added or
 * expanded in the same commit.
 *
 * Pure analysis over diff data — no async, no git, no file I/O. Used by
 * handleGetFileDiff to upgrade a bare `no_match` diagnosis to `merged`, pointing
 * the repair agent at the surviving method's declaration (the semantic
 * successor). See docs/plans/SML-1466.md for the full heuristic.
 *
 * Sibling of inline-detection.ts (SML-1465): same mechanic (cross-referencing
 * hunks within a deletion commit), different target. `inlined` matches a
 * single-statement body at a *call site*; `merged` matches multiple body fragments
 * inside *another function definition*, tolerating reflow via substring
 * containment. Deliberately conservative — requires >= 2 surviving body fragments
 * and returns null whenever the evidence is ambiguous, so the caller keeps the
 * original `no_match` rather than misleading the agent.
 */

import type { gitHistory } from '@agentic-bookmarks/core';
import {
  parseDeclaration,
  declTiedToAnchor,
  bodyIsSpecific,
  buildTemplate,
  isBraceOnly,
  isCommentOnly,
  kindLabel,
} from './inline-detection.js';

type FileDiff = gitHistory.FileDiff;

export interface MergedTarget {
  /** 0-based declaration line of the merged method in the current file. */
  line: number;
  content: string;
  symbol: string;
  confidence: 'medium' | 'low';
}

export interface MergedCandidate {
  /** 0-based declaration line of a method the body landed in. */
  line: number;
  content: string;
  symbol: string;
  matchedFragments: string[];
}

export interface MergedDetail {
  anchorLineModified: true;
  deletedSymbol: string;
  /** The specific deleted-body fragments we searched the additions for. */
  deletedKeyLines: string[];
  /** The chosen merge target (=== candidates[0]). */
  mergedInto: MergedTarget;
  /** Every distinct method the body fragments landed in, ordered by line. */
  candidates: MergedCandidate[];
  explanation: string;
}

export interface MergedDiagnosis {
  diagnosis: 'merged';
  detail: MergedDetail;
}

// At least this many distinct surviving body fragments must be found inside the
// additions before we call it a merge. A single lone fragment is the `inlined`
// detector's territory (single-statement body at a call site) and too weak to
// claim a merge here.
const MIN_FRAGMENTS = 2;
// How far up the current file we look for the enclosing declaration of a matched
// added line before giving up.
const MAX_DECL_LOOKUP = 200;

/**
 * Extract the specific body fragments worth searching for from a construct's body
 * deletion lines. Unwraps `if/while/switch/for` conditions and leading
 * `return/await/yield` so a fragment like `cleanseAnsi(data)` survives even when it
 * was originally `if (cleanseAnsi(data)) {`. Drops braces, comments, and generic
 * fragments that would match too much.
 */
function extractKeyFragments(bodyLines: string[], paramNames: string[]): string[] {
  const fragments: string[] = [];
  const seen = new Set<string>();
  for (const raw of bodyLines) {
    let t = raw.trim();
    if (t === '' || isBraceOnly(t) || isCommentOnly(t)) continue;
    t = t.replace(/\s*\{$/, '').trim(); // trailing block-opening brace
    const cf = /^(?:if|while|switch|for)\s*\((.*)\)\s*$/.exec(t);
    if (cf) t = cf[1].trim(); // unwrap the control-flow condition
    t = t.replace(/^(?:return|await|yield)\s+/, '').trim();
    t = t.replace(/;$/, '').trim();
    if (!t || isBraceOnly(t)) continue;
    if (!bodyIsSpecific(t, paramNames)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    fragments.push(t);
  }
  return fragments;
}

/** Does an addition line contain `fragment` (param-renaming tolerated)? */
function fragmentInAddition(fragment: string, paramNames: string[], candidate: string): boolean {
  const c = candidate.trim();
  const re = buildTemplate(fragment, paramNames, false); // unanchored => containment
  return re ? re.test(c) : c.includes(fragment);
}

interface EnclosingDeclaration {
  line: number;
  symbol: string;
  content: string;
  paramNames: string[];
}

/**
 * Walk up from a matched added line to the nearest enclosing declaration in the
 * current file. Returns its 0-based line, symbol, and parameter names, or null if
 * none is in range.
 */
function findEnclosingDeclaration(
  currentFileLines: string[],
  fromLine0: number,
): EnclosingDeclaration | null {
  const start = Math.min(fromLine0, currentFileLines.length - 1);
  const floor = Math.max(0, start - MAX_DECL_LOOKUP);
  for (let i = start; i >= floor; i--) {
    const decl = parseDeclaration(currentFileLines[i] ?? '');
    if (decl) return { line: i, symbol: decl.symbol, content: currentFileLines[i], paramNames: decl.paramNames };
  }
  return null;
}

/** Two declarations share a signature when their parameter name lists match. */
function sameParams(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/**
 * Detect whether the anchor's deleted construct was merged into another method or
 * function in the same commit. Returns a `merged` diagnosis, or null when the
 * pattern does not hold (caller keeps the original `no_match`).
 */
export function detectMergedConstruct(
  anchor: { lineCache?: string; lastUpdatedLine: number },
  diff: FileDiff,
  currentFileLines: string[],
): MergedDiagnosis | null {
  if (!diff || !diff.hunks || diff.hunks.length === 0) return null;
  if (currentFileLines.length === 0) return null;

  // findEnclosingDeclaration walks up to MAX_DECL_LOOKUP lines; many matched added
  // lines share the same enclosing declaration, so memoize the walk by start line
  // within this call (currentFileLines is fixed here). (SML-1568)
  const enclosingCache = new Map<number, EnclosingDeclaration | null>();
  const enclosingAt = (line0: number): EnclosingDeclaration | null => {
    const cached = enclosingCache.get(line0);
    if (cached !== undefined) return cached;
    const found = findEnclosingDeclaration(currentFileLines, line0);
    enclosingCache.set(line0, found);
    return found;
  };

  for (let h = 0; h < diff.hunks.length; h++) {
    const hunk = diff.hunks[h];
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i];
      if (line.type !== 'deletion') continue;

      const decl = parseDeclaration(line.content);
      if (!decl) continue;

      // Bound the body to THIS construct: stop at the first brace-only line (its
      // closing brace). Without this bound, adjacent merged constructs share one
      // deletion run and a sibling's declaration would leak into this body — tying
      // the wrong construct to the anchor.
      const bodyDeletionLines: string[] = [];
      for (let j = i + 1; j < hunk.lines.length; j++) {
        const bl = hunk.lines[j];
        if (bl.type !== 'deletion') break;
        if (isBraceOnly(bl.content.trim())) break;
        bodyDeletionLines.push(bl.content);
      }

      if (!declTiedToAnchor(anchor, line.content, bodyDeletionLines, decl.symbol, hunk)) continue;

      const fragments = extractKeyFragments(bodyDeletionLines, decl.paramNames);
      if (fragments.length < MIN_FRAGMENTS) continue;

      // Group every matched fragment by the enclosing declaration of its addition.
      const groups = new Map<number, { symbol: string; content: string; fragments: Set<string> }>();
      for (let hh = 0; hh < diff.hunks.length; hh++) {
        for (const cand of diff.hunks[hh].lines) {
          if (cand.type !== 'addition' || cand.newLineNumber === undefined) continue;
          const line0 = cand.newLineNumber - 1;
          // SML-1556: line0 is HEAD-relative (the diff is fromCommit -> HEAD) but
          // currentFileLines is the working tree. Only seed findEnclosingDeclaration's
          // walk-up from line0 when the working tree actually holds this added line
          // there; otherwise drift would walk up from the wrong row and report a wrong
          // merge target. (merged never runs on an empty file, so an exact match is the
          // right bar — there is no pure-diff fallback as in inline detection.)
          if (currentFileLines[line0] !== cand.content) continue;
          for (const frag of fragments) {
            if (!fragmentInAddition(frag, decl.paramNames, cand.content)) continue;
            const enc = enclosingAt(line0);
            if (!enc) continue;
            // Skip only the SAME construct re-appearing (name + signature). A
            // different method that merely shares the name can be a legitimate merge
            // target, so it must not be excluded. (SML-1568)
            if (enc.symbol === decl.symbol && sameParams(enc.paramNames, decl.paramNames)) continue;
            let g = groups.get(enc.line);
            if (!g) {
              g = { symbol: enc.symbol, content: enc.content, fragments: new Set<string>() };
              groups.set(enc.line, g);
            }
            g.fragments.add(frag);
          }
        }
      }

      const matchedFragments = new Set<string>();
      for (const g of groups.values()) for (const f of g.fragments) matchedFragments.add(f);
      if (matchedFragments.size < MIN_FRAGMENTS) continue;

      const candidates: MergedCandidate[] = [...groups.entries()]
        .map(([declLine, g]) => ({
          line: declLine,
          content: currentFileLines[declLine] ?? g.content,
          symbol: g.symbol,
          matchedFragments: [...g.fragments],
        }))
        .sort((a, b) => a.line - b.line);

      const confidence: 'medium' | 'low' = candidates.length === 1 ? 'medium' : 'low';
      const target = candidates[0];
      const where = candidates.length === 1
        ? `method \`${target.symbol}\``
        : `${candidates.length} new methods`;

      return {
        diagnosis: 'merged',
        detail: {
          anchorLineModified: true,
          deletedSymbol: decl.symbol,
          deletedKeyLines: fragments,
          mergedInto: { line: target.line, content: target.content, symbol: target.symbol, confidence },
          candidates,
          explanation: `${kindLabel(decl.kind)} body was merged into ${where} in the same commit; ${confidence} confidence`,
        },
      };
    }
  }

  return null;
}
