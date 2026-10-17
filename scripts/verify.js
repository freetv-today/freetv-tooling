import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyProduction } from './lib/production-verification.js';

/* global process */

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export function runVerifyCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  verifier = verifyProduction,
  logger = console,
} = {}) {
  try {
    const result = verifier({ toolingRoot, config: configLoader(toolingRoot) });
    const lines = [
      'FreeTV production verification passed', '', 'Application:', '  Composer runtime: OK',
      `  Package files: ${result.application.packageFileCount}`,
      `  API PHP files: ${result.api.phpFileCount} (syntax OK)`, '  Temp runtime state: clean', '',
      'Viewer:', `  Assets: ${result.viewer.assetCount}`,
      `  Static references checked: ${result.viewer.staticReferenceCount}`, '  Static references: OK', '',
      'Admin:', `  Assets: ${result.admin.assetCount}`,
      `  Static references checked: ${result.admin.staticReferenceCount}`, '  Static references: OK', '',
      'Data:', `  Playlists: ${result.data.playlistCount}`, `  Shows: ${result.data.showCount}`,
      '  Manifest integrity: OK', '', 'Thumbnails:', `  Files: ${result.thumbnails.fileCount}`,
      `  Bytes: ${result.thumbnails.totalBytes}`, '  Manifest integrity: OK', '',
      'Secrets/development debris: none', 'Symlinks: none', '', 'Ready for deployment testing.',
    ];
    lines.forEach((line) => logger.log(line));
    return 0;
  } catch (error) {
    logger.error(`FreeTV production verification failed: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) process.exitCode = runVerifyCli();
