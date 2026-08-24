import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageServerExports } from './lib/export-staging.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));

try {
  await stageServerExports({ toolingRoot, config });
} catch (error) {
  console.error(`Server export staging failed: ${error.message}`);
  process.exitCode = 1;
}
