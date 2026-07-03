import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolingRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.resolve(toolingRoot, 'config/paths.json'), 'utf8'));

const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);
const serverRoot = path.resolve(toolingRoot, config.repos.server);
const dataRoot = path.resolve(toolingRoot, config.repos.data);
const outputRoot = path.resolve(toolingRoot, config.output.root);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

console.log('Assembling deployment tree...');
removeDir(outputRoot);
ensureDir(outputRoot);

// Build output from viewer root
copyDir(path.join(viewerRoot, 'dist'), outputRoot);

// Admin build output to /admin/
copyDir(path.join(serverRoot, 'dist'), path.join(outputRoot, 'admin'));

// PHP API and admin tools
copyDir(path.join(serverRoot, 'public', 'api'), path.join(outputRoot, 'api'));
copyDir(path.join(serverRoot, 'public', 'tools'), path.join(outputRoot, 'admin', 'tools'));

// Copy data files
copyFile(path.join(dataRoot, 'config.json'), path.join(outputRoot, 'config.json'));
copyDir(path.join(dataRoot, 'playlists'), path.join(outputRoot, 'playlists'));
copyDir(path.join(dataRoot, 'thumbs'), path.join(outputRoot, 'thumbs'));
copyDir(path.join(dataRoot, 'logs'), path.join(outputRoot, 'logs'));

// Copy root static files if present
for (const entry of ['index.html', 'manifest.webmanifest', 'service-worker.js', '.htaccess']) {
  copyFile(path.join(viewerRoot, 'public', entry), path.join(outputRoot, entry));
}

// Copy admin static files if present
for (const entry of ['index.html', '.htaccess']) {
  copyFile(path.join(serverRoot, 'public', entry), path.join(outputRoot, 'admin', entry));
}

console.log(`Assembly complete. Output available at ${outputRoot}`);
