import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));
const outputRoot = path.resolve(toolingRoot, config.output.root);

const requiredPaths = [
  path.join(outputRoot, 'index.html'),
  path.join(outputRoot, 'api'),
  path.join(outputRoot, 'admin'),
  path.join(outputRoot, 'playlists'),
  path.join(outputRoot, 'thumbs'),
  path.join(outputRoot, 'logs'),
  path.join(outputRoot, 'config.json')
];

const missing = requiredPaths.filter((p) => !fs.existsSync(p));
if (missing.length) {
  console.error('Missing required paths:');
  for (const item of missing) console.error(` - ${item}`);
  process.exit(1);
}

console.log('Assembly verification passed.');
