import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installViewerDevelopmentData } from './lib/viewer-development-data.js';

const scriptPath = fileURLToPath(import.meta.url);
const toolingRoot = path.resolve(path.dirname(scriptPath), '..');

export async function runViewerDataInstallCli({ installer = installViewerDevelopmentData, logger = console } = {}) {
  try {
    const { dataRoot, publicRoot } = await installer({ toolingRoot });
    logger.log('Viewer development data installed: config.json, playlists/, thumbs/');
    logger.log(`  ${dataRoot} -> ${publicRoot}`);
    return 0;
  } catch (error) {
    logger.error(`Viewer development-data installation failed: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runViewerDataInstallCli();
}

