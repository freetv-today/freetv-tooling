import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleProduction } from './lib/production-assembly.js';

/* global process */

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));

try {
  const result = assembleProduction({ toolingRoot, config });
  console.log('Local production assembly complete:');
  console.log(`  Output: ${result.paths.outputRoot}`);
  console.log(`  Data: ${result.dataManifest.dataset.playlist_count} playlists, ${result.dataManifest.dataset.show_count} shows`);
  console.log(`  Thumbnails: ${result.thumbnailManifest.dataset.thumbnail_count} files, ${result.thumbnailManifest.dataset.total_bytes} bytes`);
  console.log(`  Files: ${result.validation.fileCount}`);
  if (result.apiExclusions.length > 0) {
    console.log(`  Excluded API entries: ${result.apiExclusions.join(', ')}`);
  }
} catch (error) {
  console.error(`Production assembly failed: ${error.message}`);
  process.exitCode = 1;
}
