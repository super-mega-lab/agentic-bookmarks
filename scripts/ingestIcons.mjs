#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesDir = join(__dirname, '..', 'packages', 'extension', 'media', 'styles');
const ingestDir = join(stylesDir, 'ingest');
const iconsDir = join(stylesDir, 'icons');

if (!existsSync(ingestDir)) {
  console.log('No ingest folder found at', ingestDir);
  process.exit(0);
}

const files = readdirSync(ingestDir).filter(f => f.endsWith('.svg'));

if (files.length === 0) {
  console.log('No SVGs found in ingest folder.');
  process.exit(0);
}

/**
 * Normalize a raw Inkscape SVG for use as a VS Code icon.
 *
 * VS Code QuickPick buttons only render SVGs reliably when the viewBox
 * uses a small coordinate space (e.g. 0 0 16 16).  Raw Inkscape exports
 * use 300mm x 300mm canvases with content translated far off the origin.
 *
 * Strategy: rewrite the SVG to use viewBox="0 0 16 16" and nest the
 * original content inside a <g> that scales from the source coordinate
 * space down to 16x16.
 */
function normalizeSvg(svg) {
  // Only process 300mm Inkscape exports
  if (!svg.includes('width="300mm"')) return svg;

  // Extract the inner content between <svg ...> and </svg>
  const openTag = svg.match(/<svg[^>]*>/i);
  const closeIdx = svg.lastIndexOf('</svg>');
  if (!openTag || closeIdx === -1) return svg;

  const innerStart = openTag.index + openTag[0].length;
  let inner = svg.substring(innerStart, closeIdx);

  // Detect translate(-N) on outer <g> and fold it into the viewBox offset
  let xOffset = 0;
  const translateMatch = inner.match(/^(\s*<g)\s+transform="translate\(-(\d+)\)"/);
  if (translateMatch) {
    xOffset = parseInt(translateMatch[2], 10);
    // Remove the translate attribute from the <g>
    inner = inner.replace(
      translateMatch[0],
      translateMatch[1]
    );
  }

  // Extract any xmlns declarations from the original <svg> tag to preserve them
  const attrs = openTag[0];
  const xmlnsDefs = [];
  const xmlnsRe = /xmlns(?::\w+)?="[^"]*"/g;
  let xm;
  while ((xm = xmlnsRe.exec(attrs)) !== null) {
    xmlnsDefs.push(xm[0]);
  }
  const xmlnsStr = xmlnsDefs.length ? ' ' + xmlnsDefs.join(' ') : ' xmlns="http://www.w3.org/2000/svg"';

  // Scale factor: map 300-unit source space into 16-unit target
  const scale = 16 / 300;

  // Build the new SVG: viewBox 0 0 16 16 with a transform group
  // that shifts by -xOffset and scales down
  const xmlDecl = svg.match(/<\?xml[^?]*\?>\s*/i)?.[0] || '';
  const comment = svg.match(/<!--[\s\S]*?-->\s*/)?.[0] || '';

  const newSvg =
    `${xmlDecl}${comment}<svg${xmlnsStr} viewBox="0 0 16 16">` +
    `<g transform="scale(${+scale.toFixed(6)})${xOffset ? ` translate(${-xOffset},0)` : ''}">` +
    inner +
    `</g></svg>\n`;

  return newSvg;
}

for (const file of files) {
  // icon_sets_car.svg -> extract "car" (third part split by _)
  const parts = file.replace('.svg', '').split('_');
  const name = parts.slice(2).join('-'); // handles multi-part like "face1"
  if (!name) {
    console.log(`  SKIP: ${file} (could not extract name)`);
    continue;
  }
  const target = `${name}-white.svg`;
  const src = join(ingestDir, file);
  const dest = join(iconsDir, target);

  const raw = readFileSync(src, 'utf8');
  const normalized = normalizeSvg(raw);
  writeFileSync(dest, normalized, 'utf8');

  const changed = raw !== normalized;
  console.log(`  ${file} -> ${target}${changed ? ' (normalized)' : ''}`);
}

console.log(`\nDone. ${files.length} icon(s) ingested.`);
