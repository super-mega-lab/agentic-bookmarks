#!/usr/bin/env node
// Simple semver incrementer for the extension package version.
// Usage: node scripts/bump-version.mjs [patch|minor|major]
// Updates: packages/extension/package.json (and echoes the new version)

import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const allowed = ['patch', 'minor', 'major'];
if (!allowed.includes(mode)) {
  console.error(`Usage: node scripts/bump-version.mjs <${allowed.join('|')}>`);
  process.exit(1);
}

const extensionPkgPath = path.resolve('packages/extension/package.json');
if (!fs.existsSync(extensionPkgPath)) {
  console.error('Cannot find extension package.json at', extensionPkgPath);
  process.exit(1);
}

const text = fs.readFileSync(extensionPkgPath, 'utf8');
let data;
try { data = JSON.parse(text); } catch (e) {
  console.error('Failed to parse extension package.json:', e.message);
  process.exit(1);
}

if (!data.version) {
  console.error('No version field found in extension package.json');
  process.exit(1);
}

const original = data.version;
const semverMatch = original.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
if (!semverMatch) {
  console.error(`Version '${original}' is not a simple semver (x.y.z[-prerelease])`);
  process.exit(1);
}

let [ , majStr, minStr, patStr, pre ] = semverMatch;
let major = parseInt(majStr, 10);
let minor = parseInt(minStr, 10);
let patch = parseInt(patStr, 10);

// On increment, drop any pre-release tag.
pre = undefined;

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
data.version = newVersion;

fs.writeFileSync(extensionPkgPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`Extension version bumped: ${original} -> ${newVersion}`);
console.log('Remember to rebuild & package: pnpm package');
console.log('Consider updating CHANGELOG.md if you maintain one.');
