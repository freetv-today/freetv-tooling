import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDatasetPublication } from './lib/data-validation.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export async function runDataValidationCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  validator = validateDatasetPublication,
  logger = console,
} = {}) {
  try {
    const config = configLoader(toolingRoot);
    await validator({ toolingRoot, config, logger });
    return 0;
  } catch (error) {
    logger.error('NO GO — Dataset is not safe to publish');
    logger.error(error.message);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runDataValidationCli();
}
