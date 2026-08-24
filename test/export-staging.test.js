import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resetStaging,
  stageServerExports,
  validateDataManifest,
  validateThumbnailManifest,
} from '../scripts/lib/export-staging.js';

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-tooling-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fileEntry(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    bytes: contents.length,
  };
}

function writeDataExport(root, overrides = {}) {
  fs.mkdirSync(path.join(root, 'playlists'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config.json'), '{"name":"test"}\n');
  fs.writeFileSync(path.join(root, 'playlists/index.json'), '{"playlists":[]}\n');
  fs.writeFileSync(path.join(root, 'playlists/example.json'), '{"shows":[]}\n');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: 1, show_count: 0 },
    files: [
      fileEntry(root, 'config.json'),
      fileEntry(root, 'playlists/index.json'),
      fileEntry(root, 'playlists/example.json'),
    ],
    ...overrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

function writeThumbnailExport(root, overrides = {}) {
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'thumbs/tt0000001.jpg'), 'jpeg fixture');
  const entry = fileEntry(root, 'thumbs/tt0000001.jpg');
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { thumbnail_count: 1, total_bytes: entry.bytes },
    files: [entry],
    ...overrides,
  };
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return manifest;
}

function rewriteManifest(root, mutate) {
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  mutate(manifest);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

test('valid Data manifest passes', (t) => {
  const root = temporaryRoot(t);
  const expected = writeDataExport(root);
  assert.deepEqual(validateDataManifest(root), expected);
});

test('invalid Data contract_version fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root, { contract_version: 2 });
  assert.throws(() => validateDataManifest(root), /contract_version/);
});

test('missing referenced Data file fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root);
  fs.rmSync(path.join(root, 'config.json'));
  assert.throws(() => validateDataManifest(root), /referenced file is missing/);
});

test('bad Data hash fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root);
  rewriteManifest(root, (manifest) => { manifest.files[0].sha256 = '0'.repeat(64); });
  assert.throws(() => validateDataManifest(root), /SHA-256 mismatch/);
});

test('bad Data byte size fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root);
  rewriteManifest(root, (manifest) => { manifest.files[0].bytes += 1; });
  assert.throws(() => validateDataManifest(root), /byte size mismatch/);
});

test('unsafe Data path fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root);
  rewriteManifest(root, (manifest) => { manifest.files[0].path = '../escape.json'; });
  assert.throws(() => validateDataManifest(root), /unsafe|escapes/);
});

test('Data playlist_count mismatch fails', (t) => {
  const root = temporaryRoot(t);
  writeDataExport(root);
  rewriteManifest(root, (manifest) => { manifest.dataset.playlist_count = 2; });
  assert.throws(() => validateDataManifest(root), /playlist_count mismatch/);
});

test('valid Thumbnail manifest passes', (t) => {
  const root = temporaryRoot(t);
  const expected = writeThumbnailExport(root);
  assert.deepEqual(validateThumbnailManifest(root), expected);
});

test('Thumbnail thumbnail_count mismatch fails', (t) => {
  const root = temporaryRoot(t);
  writeThumbnailExport(root);
  rewriteManifest(root, (manifest) => { manifest.dataset.thumbnail_count = 2; });
  assert.throws(() => validateThumbnailManifest(root), /thumbnail_count mismatch/);
});

test('Thumbnail total_bytes mismatch fails', (t) => {
  const root = temporaryRoot(t);
  writeThumbnailExport(root);
  rewriteManifest(root, (manifest) => { manifest.dataset.total_bytes += 1; });
  assert.throws(() => validateThumbnailManifest(root), /total_bytes mismatch/);
});

test('bad Thumbnail hash fails', (t) => {
  const root = temporaryRoot(t);
  writeThumbnailExport(root);
  rewriteManifest(root, (manifest) => { manifest.files[0].sha256 = '0'.repeat(64); });
  assert.throws(() => validateThumbnailManifest(root), /SHA-256 mismatch/);
});

test('unsafe Thumbnail path fails', (t) => {
  const root = temporaryRoot(t);
  writeThumbnailExport(root);
  rewriteManifest(root, (manifest) => { manifest.files[0].path = '../escape.jpg'; });
  assert.throws(() => validateThumbnailManifest(root), /unsafe|escapes/);
});

function workflowConfig() {
  return {
    repos: { server: 'server' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
  };
}

test('Server Data exporter failure stops the workflow', async (t) => {
  const toolingRoot = temporaryRoot(t);
  let calls = 0;
  const runner = async () => {
    calls += 1;
    throw new Error('data failed');
  };
  await assert.rejects(
    stageServerExports({ toolingRoot, config: workflowConfig(), commandRunner: runner }),
    /data failed/,
  );
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(toolingRoot, 'staging')), false);
});

test('Thumbnail exporter failure removes this run staging', async (t) => {
  const toolingRoot = temporaryRoot(t);
  let calls = 0;
  const runner = async ({ args }) => {
    calls += 1;
    if (calls === 1) writeDataExport(args[1]);
    else throw new Error('thumbnail failed');
  };
  await assert.rejects(
    stageServerExports({ toolingRoot, config: workflowConfig(), commandRunner: runner }),
    /thumbnail failed/,
  );
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(path.join(toolingRoot, 'staging')), false);
});

test('safe staging reset cannot delete outside Tooling-owned root', (t) => {
  const toolingRoot = temporaryRoot(t);
  const outside = path.join(toolingRoot, 'keep');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'important.txt'), 'keep');
  assert.throws(
    () => resetStaging(outside, path.join(toolingRoot, 'staging')),
    /outside Tooling-owned staging root/,
  );
  assert.equal(fs.readFileSync(path.join(outside, 'important.txt'), 'utf8'), 'keep');
});
