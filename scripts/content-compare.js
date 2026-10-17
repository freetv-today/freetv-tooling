import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatComparisonReport,
  resolveLocalDataPath,
  runContentComparison,
} from './lib/content-comparison.js';

/* global process */

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export function runContentCompareCli({
  args = process.argv.slice(2), toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  comparator = runContentComparison, formatter = formatComparisonReport,
  logger = console, output = process.stdout,
} = {}) {
  if (args.length !== 1 || !args[0]) {
    logger.error('Usage: npm run content:compare -- <snapshot-directory-or-zip>');
    return 1;
  }
  try {
    const config = configLoader(toolingRoot);
    const comparison = comparator({
      snapshotPath: args[0],
      dataRoot: resolveLocalDataPath(toolingRoot, config),
    });
    output.write(formatter(comparison));
    return 0;
  } catch (error) {
    logger.error(`Content comparison failed: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) process.exitCode = runContentCompareCli();
