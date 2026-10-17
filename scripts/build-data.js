import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageAdminExports } from './lib/export-staging.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export async function runStageExportsCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  stager = stageAdminExports,
  logger = console,
} = {}) {
  try {
    await stager({ toolingRoot, config: configLoader(toolingRoot), logger });
    return 0;
  } catch (error) {
    logger.error(`Admin export staging failed: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runStageExportsCli();
}
