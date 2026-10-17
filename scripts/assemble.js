import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleProduction } from './lib/production-assembly.js';

/* global process */

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export function runAssembleCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  assembler = assembleProduction,
  logger = console,
} = {}) {
  try {
    const result = assembler({ toolingRoot, config: configLoader(toolingRoot) });
    logger.log('Local production assembly complete:');
    logger.log(`  Output: ${result.paths.outputRoot}`);
    logger.log(`  Data: ${result.dataManifest.dataset.playlist_count} playlists, ${result.dataManifest.dataset.show_count} shows`);
    logger.log(`  Thumbnails: ${result.thumbnailManifest.dataset.thumbnail_count} files, ${result.thumbnailManifest.dataset.total_bytes} bytes`);
    logger.log(`  Files: ${result.validation.fileCount}`);
    if (result.apiExclusions.length > 0) logger.log(`  Excluded API entries: ${result.apiExclusions.join(', ')}`);
    return 0;
  } catch (error) {
    logger.error(`Production assembly failed: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) process.exitCode = runAssembleCli();
