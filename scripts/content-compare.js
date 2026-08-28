import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatComparisonReport,
  resolveLocalDataPath,
  runContentComparison,
} from './lib/content-comparison.js';

/* global process */

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = process.argv[2];

if (!snapshotPath || process.argv.length !== 3) {
  console.error('Usage: npm run content:compare -- <snapshot-directory-or-zip>');
  process.exitCode = 1;
} else {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));
    const comparison = runContentComparison({
      snapshotPath,
      dataRoot: resolveLocalDataPath(toolingRoot, config),
    });
    process.stdout.write(formatComparisonReport(comparison));
  } catch (error) {
    console.error(`Content comparison failed: ${error.message}`);
    process.exitCode = 1;
  }
}
