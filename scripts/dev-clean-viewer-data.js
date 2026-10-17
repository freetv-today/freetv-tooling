import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanViewerDevelopmentData } from './lib/viewer-development-data.js';

const scriptPath = fileURLToPath(import.meta.url);
const toolingRoot = path.resolve(path.dirname(scriptPath), '..');

export async function runViewerDataCleanCli({ cleaner = cleanViewerDevelopmentData, logger = console } = {}) {
  try {
    const { publicRoot } = await cleaner({ toolingRoot });
    logger.log(`Viewer development data cleaned from ${publicRoot}: config.json, playlists/, thumbs/`);
    return 0;
  } catch (error) {
    logger.error(`Viewer development-data cleanup failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runViewerDataCleanCli();
}

