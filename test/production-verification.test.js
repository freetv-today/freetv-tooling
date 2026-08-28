import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyProduction } from '../scripts/lib/production-verification.js';

const SPA_HTACCESS = `RewriteEngine On
RewriteBase /

# Admin Dashboard SPA routes
RewriteCond %{REQUEST_URI} ^/admin(?:/|$)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^admin(?:/.*)?$ /admin/index.html [L]

# Viewer SPA routes
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
`;

function pngFixture(width, height) {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

function viewerManifest() {
  return {
    id: '/', name: 'FreeTV Viewer', short_name: 'FreeTV', lang: 'en-US', description: 'FreeTV fixture',
    start_url: '/', scope: '/', display: 'standalone', display_override: ['standalone', 'minimal-ui'],
    icons: [
      { src: '/assets/app-icons/freetv-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/app-icons/freetv-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/assets/app-icons/freetv-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable',
      },
    ],
  };
}

function writeFile(root, relativePath, contents = 'fixture') {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function manifestEntry(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    bytes: contents.length,
  };
}

function writeStaging(toolingRoot) {
  const dataRoot = path.join(toolingRoot, 'staging/data');
  writeFile(dataRoot, 'config.json', '{"show_ads":false}\n');
  writeFile(dataRoot, 'playlists/index.json', JSON.stringify({
    default: 'example.json',
    playlists: [{ filename: 'example.json' }],
  }));
  writeFile(dataRoot, 'playlists/example.json', JSON.stringify({ shows: [{ title: 'Example' }] }));
  const dataManifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: 1, show_count: 1 },
    files: [
      manifestEntry(dataRoot, 'config.json'),
      manifestEntry(dataRoot, 'playlists/index.json'),
      manifestEntry(dataRoot, 'playlists/example.json'),
    ],
  };
  writeFile(dataRoot, 'manifest.json', JSON.stringify(dataManifest));

  const thumbnailRoot = path.join(toolingRoot, 'staging/thumbnails');
  writeFile(thumbnailRoot, 'thumbs/tt0000001.jpg', 'jpeg fixture');
  const thumbnailEntry = manifestEntry(thumbnailRoot, 'thumbs/tt0000001.jpg');
  const thumbnailManifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { thumbnail_count: 1, total_bytes: thumbnailEntry.bytes },
    files: [thumbnailEntry],
  };
  writeFile(thumbnailRoot, 'manifest.json', JSON.stringify(thumbnailManifest));
}

function createFixture(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-verification-test-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const toolingRoot = path.join(workspaceRoot, 'freetv-tooling');
  const outputRoot = path.join(workspaceRoot, 'production');
  fs.mkdirSync(toolingRoot);
  writeStaging(toolingRoot);

  writeFile(outputRoot, 'composer.json', '{}\n');
  writeFile(outputRoot, 'composer.lock', '{}\n');
  writeFile(outputRoot, 'vendor/autoload.php', '<?php\n');
  fs.mkdirSync(path.join(outputRoot, 'temp/publication-undo'), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, 'temp/thumbnail-undo'), { recursive: true });

  writeFile(outputRoot, 'public/.htaccess', SPA_HTACCESS);
  writeFile(outputRoot, 'public/index.html', [
    '<link rel="manifest" href="/manifest.json">',
    '<link rel="stylesheet" href="/assets/viewer.css">',
    '<script src="/assets/viewer.js"></script>',
    '<img src="/assets/icon.png">',
  ].join('\n'));
  writeFile(outputRoot, 'public/assets/viewer.js', 'const icon = "/assets/icon.png";\n');
  writeFile(outputRoot, 'public/assets/viewer.css', 'body { background: url(/assets/icon.png); }\n');
  writeFile(outputRoot, 'public/assets/icon.png', 'png fixture');
  writeFile(outputRoot, 'public/assets/app-icons/freetv-192x192.png', pngFixture(192, 192));
  writeFile(outputRoot, 'public/assets/app-icons/freetv-512x512.png', pngFixture(512, 512));
  writeFile(outputRoot, 'public/assets/app-icons/freetv-512x512-maskable.png', pngFixture(512, 512));
  writeFile(outputRoot, 'public/manifest.json', JSON.stringify(viewerManifest()));
  writeFile(outputRoot, 'public/service-worker.js', [
    'const STATIC_ASSETS = [',
    "  '/',",
    "  '/index.html',",
    "  '/manifest.json',",
    "  '/assets/app-icons/freetv-192x192.png',",
    '];',
  ].join('\n'));

  writeFile(outputRoot, 'public/admin/index.html', [
    '<link rel="stylesheet" href="/admin/assets/admin.css">',
    '<script src="/admin/assets/admin.js"></script>',
  ].join('\n'));
  writeFile(outputRoot, 'public/admin/assets/admin.js', 'const icon = "/admin/assets/icon.svg";\n');
  writeFile(outputRoot, 'public/admin/assets/admin.css', 'body { background: url(/admin/assets/icon.svg); }\n');
  writeFile(outputRoot, 'public/admin/assets/icon.svg', '<svg/>');

  writeFile(outputRoot, 'public/api/index.php', "<?php\nrequire_once __DIR__ . '/admin/status.php';\n");
  writeFile(outputRoot, 'public/api/admin/status.php', '<?php\n');
  writeFile(outputRoot, 'public/api/admin/publication/status.php', '<?php\n');
  writeFile(outputRoot, 'public/config.json', fs.readFileSync(path.join(toolingRoot, 'staging/data/config.json')));
  writeFile(outputRoot, 'public/playlists/index.json', fs.readFileSync(path.join(toolingRoot, 'staging/data/playlists/index.json')));
  writeFile(outputRoot, 'public/playlists/example.json', fs.readFileSync(path.join(toolingRoot, 'staging/data/playlists/example.json')));
  writeFile(outputRoot, 'public/thumbs/tt0000001.jpg', fs.readFileSync(path.join(toolingRoot, 'staging/thumbnails/thumbs/tt0000001.jpg')));

  const config = {
    repos: { viewer: '../freetv-viewer', server: '../freetv-server' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
    output: { root: '../production' },
  };
  return { workspaceRoot, toolingRoot, outputRoot, config };
}

function verifyFixture(fixture, overrides = {}) {
  return verifyProduction({
    toolingRoot: fixture.toolingRoot,
    config: fixture.config,
    phpCommandRunner: () => {},
    ...overrides,
  });
}

function treeSnapshot(root) {
  const snapshot = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      const stats = fs.lstatSync(absolutePath);
      snapshot.push([relativePath, stats.mode, stats.size, stats.mtimeMs]);
      if (entry.isDirectory()) visit(absolutePath);
    }
  };
  visit(root);
  return snapshot;
}

test('valid package passes without modifying it', (t) => {
  const fixture = createFixture(t);
  const before = treeSnapshot(fixture.outputRoot);
  const result = verifyFixture(fixture);
  assert.equal(result.application.packageFileCount, 24);
  assert.equal(result.data.playlistCount, 1);
  assert.equal(result.data.showCount, 1);
  assert.equal(result.thumbnails.fileCount, 1);
  assert.deepEqual(treeSnapshot(fixture.outputRoot), before);
});

test('missing required application root fails', (t) => {
  const fixture = createFixture(t);
  fs.rmSync(path.join(fixture.outputRoot, 'composer.lock'));
  assert.throws(() => verifyFixture(fixture), /missing required root entries/);
});

test('unexpected application root entry fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'README.txt', 'unexpected');
  assert.throws(() => verifyFixture(fixture), /unexpected root entries/);
});

test('missing Viewer .htaccess fails verification', (t) => {
  const fixture = createFixture(t);
  fs.rmSync(path.join(fixture.outputRoot, 'public/.htaccess'));
  assert.throws(() => verifyFixture(fixture), /missing required root entries: .htaccess/);
});

test('modified Viewer .htaccess fails verification', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/.htaccess', 'RewriteEngine Off\n');
  assert.throws(() => verifyFixture(fixture), /Production public\/.htaccess does not match the Viewer SPA fallback contract/);
});

test('.env fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'vendor/package/.env', 'SECRET=fixture');
  assert.throws(() => verifyFixture(fixture), /forbidden credential content|forbidden secret/);
});

test('key files fail', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'vendor/package/private.key', 'fixture');
  assert.throws(() => verifyFixture(fixture), /forbidden credential content|forbidden secret/);
});

test('symlinks fail', (t) => {
  const fixture = createFixture(t);
  fs.symlinkSync(path.join(fixture.outputRoot, 'composer.json'), path.join(fixture.outputRoot, 'vendor/link'));
  assert.throws(() => verifyFixture(fixture), /symbolic link/);
});

test('Viewer missing static asset reference fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/index.html', '<img src="/assets/missing.png">');
  assert.throws(() => verifyFixture(fixture), /Viewer static reference.*missing/);
});

test('Admin root assets reference fails ownership', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/admin/index.html', '<img src="/assets/icon.png">');
  assert.throws(() => verifyFixture(fixture), /Admin static reference uses Viewer-owned \/assets/);
});

test('missing manifest icon fails', (t) => {
  const fixture = createFixture(t);
  const manifest = viewerManifest();
  manifest.icons[0].src = '/assets/app-icons/missing.png';
  writeFile(fixture.outputRoot, 'public/manifest.json', JSON.stringify(manifest));
  assert.throws(() => verifyFixture(fixture), /unexpected icon|manifest icon does not resolve|static reference.*missing/);
});

test('retired public manifest.webmanifest fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/manifest.webmanifest', '{}');
  assert.throws(() => verifyFixture(fixture), /unexpected root entries: manifest.webmanifest/);
});

test('Data hash mismatch fails', (t) => {
  const fixture = createFixture(t);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/config.json'), 'tamper');
  assert.throws(() => verifyFixture(fixture), /Data assembled byte size mismatch|Data assembled SHA-256 mismatch/);
});

test('extra playlist fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/playlists/extra.json', '{"shows":[]}');
  assert.throws(() => verifyFixture(fixture), /files outside its manifest/);
});

test('Thumbnail hash mismatch fails', (t) => {
  const fixture = createFixture(t);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/thumbs/tt0000001.jpg'), 'tamper');
  assert.throws(() => verifyFixture(fixture), /Thumbnail assembled byte size mismatch|Thumbnail assembled SHA-256 mismatch/);
});

test('extra thumbnail fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/thumbs/tt0000002.jpg', 'extra');
  assert.throws(() => verifyFixture(fixture), /files outside its manifest/);
});

test('dirty temp runtime state fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'temp/publication-undo/operation.json', '{}');
  assert.throws(() => verifyFixture(fixture), /runtime directory must be empty/);
});

test('invalid PHP syntax fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/api/index.php', '<?php function broken( {');
  assert.throws(
    () => verifyFixture(fixture, {
      phpCommandRunner: (args, label) => {
        if (args[0] === '-l' && fs.readFileSync(args[1], 'utf8').includes('function broken')) {
          throw new Error(`${label} failed: simulated PHP parse error`);
        }
      },
    }),
    /PHP syntax check.*failed/,
  );
});

test('missing vendor autoload fails', (t) => {
  const fixture = createFixture(t);
  fs.rmSync(path.join(fixture.outputRoot, 'vendor/autoload.php'));
  assert.throws(() => verifyFixture(fixture), /vendor\/autoload.php is missing/);
});

test('unreviewed API directory fails', (t) => {
  const fixture = createFixture(t);
  writeFile(fixture.outputRoot, 'public/api/unreviewed/file.php', '<?php\n');
  assert.throws(() => verifyFixture(fixture), /unreviewed runtime directory/);
});

test('production tools directory fails', (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(path.join(fixture.outputRoot, 'public/tools'));
  assert.throws(() => verifyFixture(fixture), /unexpected root entries/);
});
