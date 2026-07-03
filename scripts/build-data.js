import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const dataRoot = path.resolve(toolingRoot, config.repos.data);
const outputRoot = path.resolve(toolingRoot, config.output.root);

console.log('Preparing data export paths...');

for (const dir of [outputRoot, path.join(outputRoot, 'playlists'), path.join(outputRoot, 'thumbs'), path.join(outputRoot, 'logs')]) {
  fs.mkdirSync(dir, { recursive: true });
}

for (const entry of ['config.json', 'playlists', 'thumbs', 'logs']) {
  const source = path.join(dataRoot, entry);
  const target = path.join(outputRoot, entry);
  if (fs.existsSync(source)) {
    if (fs.statSync(source).isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

console.log('Data staging complete.');
