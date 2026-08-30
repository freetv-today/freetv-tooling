import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanViewerDevelopmentData } from './lib/viewer-development-data.js';

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const { publicRoot } = await cleanViewerDevelopmentData({ toolingRoot });
  console.log(`Viewer development data cleaned from ${publicRoot}: config.json, playlists/, thumbs/`);
} catch (error) {
  console.error(`Viewer development-data cleanup failed: ${error.message}`);
  process.exitCode = 1;
}

