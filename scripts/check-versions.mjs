#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'package.json',
  'app/native-server/package.json',
  'app/chrome-extension/package.json',
  'packages/shared/package.json',
];
const versions = files.map((relativePath) => {
  const data = JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  return { relativePath, version: data.version };
});
const expected = versions[0].version;
const mismatched = versions.filter((item) => item.version !== expected);
if (mismatched.length > 0) {
  console.error(`Package versions must match ${expected}:`);
  for (const item of versions) console.error(`- ${item.relativePath}: ${item.version}`);
  process.exit(1);
}
console.log(`Package versions are aligned at ${expected}.`);
