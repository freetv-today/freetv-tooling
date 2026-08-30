import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installViewerDevelopmentData } from './lib/viewer-development-data.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const { dataRoot, publicRoot } = await installViewerDevelopmentData({ toolingRoot });
  console.log('Viewer development data installed: config.json, playlists/, thumbs/');
  console.log(`  ${dataRoot} -> ${publicRoot}`);
} catch (error) {
  console.error(`Viewer development-data installation failed: ${error.message}`);
  process.exitCode = 1;
}

