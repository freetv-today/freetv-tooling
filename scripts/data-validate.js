import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatasetPublication } from './lib/data-validation.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));
  await validateDatasetPublication({ toolingRoot, config });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

