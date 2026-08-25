import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyProduction } from './lib/production-verification.js';

/* global process */

const toolingRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));

try {
  const result = verifyProduction({ toolingRoot, config });
  console.log('FreeTV production verification passed');
  console.log('');
  console.log('Application:');
  console.log('  Composer runtime: OK');
  console.log(`  Package files: ${result.application.packageFileCount}`);
  console.log(`  API PHP files: ${result.api.phpFileCount} (syntax OK)`);
  console.log('  Temp runtime state: clean');
  console.log('');
  console.log('Viewer:');
  console.log(`  Assets: ${result.viewer.assetCount}`);
  console.log(`  Static references checked: ${result.viewer.staticReferenceCount}`);
  console.log('  Static references: OK');
  console.log('');
  console.log('Admin:');
  console.log(`  Assets: ${result.admin.assetCount}`);
  console.log(`  Static references checked: ${result.admin.staticReferenceCount}`);
  console.log('  Static references: OK');
  console.log('');
  console.log('Data:');
  console.log(`  Playlists: ${result.data.playlistCount}`);
  console.log(`  Shows: ${result.data.showCount}`);
  console.log('  Manifest integrity: OK');
  console.log('');
  console.log('Thumbnails:');
  console.log(`  Files: ${result.thumbnails.fileCount}`);
  console.log(`  Bytes: ${result.thumbnails.totalBytes}`);
  console.log('  Manifest integrity: OK');
  console.log('');
  console.log('Secrets/development debris: none');
  console.log('Symlinks: none');
  console.log('');
  console.log('Ready for deployment testing.');
} catch (error) {
  console.error(`FreeTV production verification failed: ${error.message}`);
  process.exitCode = 1;
}
