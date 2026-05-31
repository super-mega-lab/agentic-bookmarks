#!/usr/bin/env node
// Simple semver incrementer for the workspace version.
// Usage: node scripts/bump-version.mjs [patch|minor|major]
//
// The extension package.json holds the canonical version (it's what ships to
// the marketplace). The root workspace package.json and the server package
// are kept in lockstep with it so the whole workspace reports one version.
// packages/licensing is intentionally left on its own version track.

import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const allowed = ['patch', 'minor', 'major'];
if (!allowed.includes(mode)) {
  console.error(`Usage: node scripts/bump-version.mjs <${allowed.join('|')}>`);
  process.exit(1);
}

const canonicalPkgPath = path.resolve('packages/extension/package.json');
const lockstepPkgPaths = [
  path.resolve('package.json'),
  path.resolve('packages/server/package.json'),
];

function readPkg(pkgPath) {
  if (!fs.existsSync(pkgPath)) {
    console.error('Cannot find package.json at', pkgPath);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${pkgPath}:`, e.message);
    process.exit(1);
  }
}

function writePkg(pkgPath, data) {
  fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const canonical = readPkg(canonicalPkgPath);
if (!canonical.version) {
  console.error('No version field found in extension package.json');
  process.exit(1);
}

const original = canonical.version;
const semverMatch = original.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
if (!semverMatch) {
  console.error(`Version '${original}' is not a simple semver (x.y.z[-prerelease])`);
  process.exit(1);
}

let [ , majStr, minStr, patStr ] = semverMatch;
let major = parseInt(majStr, 10);
let minor = parseInt(minStr, 10);
let patch = parseInt(patStr, 10);

// On increment, drop any pre-release tag.
switch (mode) {
  case 'patch':
    patch += 1;
    break;
  case 'minor':
    minor += 1; patch = 0;
    break;
  case 'major':
    major += 1; minor = 0; patch = 0;
    break;
}

const newVersion = `${major}.${minor}.${patch}`;

// Write the new version to the canonical package and every lockstep package,
// so a drifted root/server version is healed back into sync on each bump.
canonical.version = newVersion;
writePkg(canonicalPkgPath, canonical);

for (const pkgPath of lockstepPkgPaths) {
  const data = readPkg(pkgPath);
  data.version = newVersion;
  writePkg(pkgPath, data);
}

const updated = [canonicalPkgPath, ...lockstepPkgPaths]
  .map((p) => path.relative(process.cwd(), p))
  .join(', ');

console.log(`Version bumped: ${original} -> ${newVersion}`);
console.log(`Updated: ${updated}`);
console.log('Remember to rebuild & package: pnpm package');
console.log('Consider updating CHANGELOG.md if you maintain one.');
