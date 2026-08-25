import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assembleProduction,
  OwnershipRegistry,
  validateProductionOutput,
} from '../scripts/lib/production-assembly.js';

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function writeFile(root, relativePath, contents = 'fixture') {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function manifestEntry(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return { path: relativePath, sha256: sha256(contents), bytes: contents.length };
}

function writeDataStaging(root) {
  writeFile(root, 'config.json', '{"name":"fixture"}\n');
  writeFile(root, 'playlists/index.json', '{"playlists":[]}\n');
  writeFile(root, 'playlists/example.json', '{"shows":[]}\n');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: 1, show_count: 0 },
    files: [
      manifestEntry(root, 'config.json'),
      manifestEntry(root, 'playlists/index.json'),
      manifestEntry(root, 'playlists/example.json'),
    ],
  };
  writeFile(root, 'manifest.json', JSON.stringify(manifest));
  return manifest;
}

function writeThumbnailStaging(root) {
  writeFile(root, 'thumbs/tt0000001.jpg', 'jpeg fixture');
  const entry = manifestEntry(root, 'thumbs/tt0000001.jpg');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { thumbnail_count: 1, total_bytes: entry.bytes },
    files: [entry],
  };
  writeFile(root, 'manifest.json', JSON.stringify(manifest));
  return manifest;
}

function createWorkspace(t) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-assembly-test-'));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const toolingRoot = path.join(workspaceRoot, 'freetv-tooling');
  const viewerRoot = path.join(workspaceRoot, 'freetv-viewer');
  const serverRoot = path.join(workspaceRoot, 'freetv-server');
  fs.mkdirSync(toolingRoot);

  writeFile(viewerRoot, 'dist/index.html', '<!doctype html>');
  writeFile(viewerRoot, 'dist/assets/viewer.js', 'export {};');
  writeFile(viewerRoot, 'dist/assets/viewer.css', 'body {}');
  writeFile(viewerRoot, 'dist/assets/icon.png', 'png fixture');
  writeFile(viewerRoot, 'dist/manifest.webmanifest', JSON.stringify({
    icons: [{ src: 'assets/icon.png' }],
  }));
  writeFile(viewerRoot, 'dist/service-worker.js', '/* service worker */');

  writeFile(serverRoot, 'dist/index.html', '<!doctype html>');
  writeFile(serverRoot, 'dist/assets/admin.js', 'export {};');
  writeFile(serverRoot, 'dist/assets/admin.css', 'body {}');
  writeFile(serverRoot, 'public/api/index.php', '<?php');
  writeFile(serverRoot, 'public/api/admin/status.php', '<?php');
  writeFile(serverRoot, 'public/api/beacon.php', '<?php');
  writeFile(serverRoot, 'public/api/.env', 'API_SECRET=fixture');
  writeFile(serverRoot, 'public/api/tests/test.php', '<?php');
  writeFile(serverRoot, 'public/api/backup.sql', 'fixture');
  writeFile(serverRoot, 'composer.json', '{}\n');
  writeFile(serverRoot, 'composer.lock', '{}\n');
  writeFile(serverRoot, 'vendor/autoload.php', '<?php');
  writeFile(serverRoot, 'vendor/package/src/Dependency.php', '<?php');
  writeFile(serverRoot, 'vendor/package/.git/config', 'fixture');
  writeFile(serverRoot, 'vendor/package/tests/DependencyTest.php', '<?php');
  writeFile(serverRoot, 'vendor/package/tools/generate.php', '<?php');
  writeFile(serverRoot, '.env', 'DB_PASSWORD=fixture');
  writeFile(serverRoot, 'temp/publication-undo/operation.json', '{}');
  writeFile(serverRoot, 'temp/thumbnail-undo/backup.jpg', 'fixture');

  const dataRoot = path.join(toolingRoot, 'staging/data');
  const thumbnailRoot = path.join(toolingRoot, 'staging/thumbnails');
  const dataManifest = writeDataStaging(dataRoot);
  const thumbnailManifest = writeThumbnailStaging(thumbnailRoot);
  const config = {
    repos: { viewer: '../freetv-viewer', server: '../freetv-server' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
    output: { root: '../production' },
  };
  return {
    workspaceRoot,
    toolingRoot,
    viewerRoot,
    serverRoot,
    outputRoot: path.join(workspaceRoot, 'production'),
    dataRoot,
    thumbnailRoot,
    dataManifest,
    thumbnailManifest,
    config,
  };
}

test('valid production assembly succeeds', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  assert.ok(result.validation.fileCount > 0);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/index.html')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/admin/index.html')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/index.php')), true);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/autoload.php')), true);
});

test('missing Viewer dist fails before replacing existing output', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.outputRoot, 'keep.txt', 'keep');
  fs.rmSync(path.join(fixture.viewerRoot, 'dist'), { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Viewer dist is missing/);
  assert.equal(fs.readFileSync(path.join(fixture.outputRoot, 'keep.txt'), 'utf8'), 'keep');
});

test('invalid Viewer dist fails', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.viewerRoot, 'dist/config.json', '{}');
  assert.throws(() => assembleProduction(fixture), /Viewer dist contains unexpected root entries/);
});

test('missing Admin dist fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(path.join(fixture.serverRoot, 'dist'), { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Server Admin dist is missing/);
});

test('missing staging fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(fixture.dataRoot, { recursive: true });
  assert.throws(() => assembleProduction(fixture), /Data manifest is missing/);
});

test('missing vendor autoload fails', (t) => {
  const fixture = createWorkspace(t);
  fs.rmSync(path.join(fixture.serverRoot, 'vendor/autoload.php'));
  assert.throws(() => assembleProduction(fixture), /vendor\/autoload.php is missing/);
});

test('destination ownership collisions fail even for identical bytes', () => {
  const ownership = new OwnershipRegistry();
  ownership.claim('/tmp/assembly-collision', 'Viewer');
  assert.throws(
    () => ownership.claim('/tmp/assembly-collision', 'Admin'),
    /Destination collision.*Viewer and Admin/,
  );
});

test('unsafe production output root is rejected without deletion', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.toolingRoot, 'keep.txt', 'keep');
  fixture.config.output.root = '.';
  assert.throws(() => assembleProduction(fixture), /expected Tooling-owned boundary|overlap/);
  assert.equal(fs.readFileSync(path.join(fixture.toolingRoot, 'keep.txt'), 'utf8'), 'keep');
});

test('.env and denied API content are not copied', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, '.env')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/.env')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/beacon.php')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/tests')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/api/backup.sql')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/.git')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/tests')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/tools')), false);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'vendor/package/src/Dependency.php')), true);
  assert.ok(result.apiExclusions.includes('beacon.php'));
});

test('existing Server temp and Undo state are not copied', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'temp/publication-undo')), []);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'temp/thumbnail-undo')), []);
});

test('assembled Data remains covered by staging hashes and sizes', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/config.json'), 'tamper');
  assert.throws(
    () => validateProductionOutput({
      paths: result.paths,
      dataManifest: fixture.dataManifest,
      thumbnailManifest: fixture.thumbnailManifest,
    }),
    /Data assembled byte size mismatch/,
  );
});

test('assembled Thumbnails remain covered by staging hashes and sizes', (t) => {
  const fixture = createWorkspace(t);
  const result = assembleProduction(fixture);
  fs.appendFileSync(path.join(fixture.outputRoot, 'public/thumbs/tt0000001.jpg'), 'tamper');
  assert.throws(
    () => validateProductionOutput({
      paths: result.paths,
      dataManifest: fixture.dataManifest,
      thumbnailManifest: fixture.thumbnailManifest,
    }),
    /Thumbnail assembled byte size mismatch/,
  );
});

test('staging manifests and Admin runtime paths are absent from public output', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/manifest.json')), false);
  for (const entry of ['api', 'config.json', 'playlists', 'thumbs']) {
    assert.equal(fs.existsSync(path.join(fixture.outputRoot, 'public/admin', entry)), false);
  }
});

test('only declared ownership roots appear in production', (t) => {
  const fixture = createWorkspace(t);
  assembleProduction(fixture);
  assert.deepEqual(fs.readdirSync(fixture.outputRoot).sort(), [
    'composer.json', 'composer.lock', 'public', 'temp', 'vendor',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(fixture.outputRoot, 'public')).sort(), [
    'admin', 'api', 'assets', 'config.json', 'index.html', 'manifest.webmanifest',
    'playlists', 'service-worker.js', 'thumbs',
  ]);
});

test('forbidden nested Admin runtime content is rejected before assembly', (t) => {
  const fixture = createWorkspace(t);
  writeFile(fixture.serverRoot, 'dist/api/index.php', '<?php');
  assert.throws(() => assembleProduction(fixture), /Server Admin dist contains unexpected root entries/);
});
