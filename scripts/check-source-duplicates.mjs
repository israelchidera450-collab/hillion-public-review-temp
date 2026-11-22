import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const roots = ['src', 'android/app/src/main'];
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.css', '.kt', '.java', '.xml']);
const seen = new Map();
const duplicates = [];

async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['build', 'generated', '.gradle'].includes(entry.name)) continue;
      await walk(full);
      continue;
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
    const content = (await readFile(full, 'utf8')).replace(/^\uFEFF/, '').trim();
    if (!content) continue;
    const digest = createHash('sha256').update(content).digest('hex');
    const prior = seen.get(digest);
    if (prior) duplicates.push([prior, full]);
    else seen.set(digest, full);
  }
}

for (const root of roots) await walk(root);
if (duplicates.length) {
  console.error('Exact duplicate source files detected:');
  for (const [first, second] of duplicates) console.error(' - ' + first + ' == ' + second);
  process.exitCode = 1;
} else {
  console.log('Source duplicate check passed: no exact duplicate source files found.');
}
