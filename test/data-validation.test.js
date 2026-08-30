import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveDatasetValidationPaths,
  validateDatasetPublication,
} from '../scripts/lib/data-validation.js';

const SQL_FILES = [
  'freetv_mariadb_schema-create-db.sql',
  'freetv_mariadb_schema-tables-only.sql',
  'freetv_mariadb_full-create-db.sql',
  'freetv_mariadb_full_data-tables-only.sql',
  'freetv_mariadb_sample-create-db.sql',
  'freetv_mariadb_sample_data-tables-only.sql',
];

function write(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function fileEntry(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    bytes: contents.length,
  };
}

function writeDataExport(root, playlistCount = 7, showCount = 913) {
  write(path.join(root, 'config.json'), '{"show_ads":false}\n');
  write(path.join(root, 'playlists/index.json'), '{"default":"playlist-0.json"}\n');
  const files = ['config.json', 'playlists/index.json'];
  for (let index = 0; index < playlistCount; index += 1) {
    const relativePath = `playlists/playlist-${index}.json`;
    write(path.join(root, relativePath), `{"shows":[${index}]}\n`);
    files.push(relativePath);
  }
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: playlistCount, show_count: showCount },
    files: files.map((file) => fileEntry(root, file)),
  };
  write(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
}

function writeThumbnailExport(root) {
  write(path.join(root, 'thumbs/one.jpg'), 'one');
  write(path.join(root, 'thumbs/two.jpg'), 'two-two');
  const files = ['thumbs/one.jpg', 'thumbs/two.jpg'].map((file) => fileEntry(root, file));
  const manifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: {
      thumbnail_count: files.length,
      total_bytes: files.reduce((total, file) => total + file.bytes, 0),
    },
    files,
  };
  write(path.join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
}

function treeSnapshot(root) {
  const snapshot = [];
  function visit(directory, relativeRoot = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = path.join(relativeRoot, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot.push(`directory:${relativePath}`);
        visit(absolutePath, relativePath);
      } else {
        snapshot.push(`file:${relativePath}:${fs.readFileSync(absolutePath, 'utf8')}`);
      }
    }
  }
  visit(root);
  return snapshot;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-data-validation-'));
  const toolingRoot = path.join(root, 'tooling');
  const serverRoot = path.join(root, 'server');
  const dataRoot = path.join(root, 'data');
  for (const tool of [
    'export-viewer-data.php',
    'export-thumbnails.php',
    'generate-sql-packages.php',
    'validate-sql-packages.php',
  ]) write(path.join(serverRoot, 'tools', tool), '<?php');
  write(path.join(serverRoot, 'sql/canonical.sql'), '-- keep');
  write(path.join(dataRoot, 'config.json'), '{"published":true}\n');
  write(path.join(dataRoot, 'playlists/index.json'), '{}\n');
  write(path.join(dataRoot, 'thumbs/keep.jpg'), 'keep');
  write(path.join(toolingRoot, 'staging/keep.txt'), 'keep');
  const config = {
    repos: { server: '../server', data: '../data' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
  };
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { config, dataRoot, root, serverRoot, toolingRoot };
}

function mockRunner({ failLabel, mismatch = false } = {}) {
  const calls = [];
  const runner = async (command) => {
    calls.push(command);
    if (command.label === failLabel) throw new Error(`${failLabel} injected failure`);
    if (command.label === 'Server Data exporter') writeDataExport(command.args[1]);
    if (command.label === 'Server Thumbnail exporter') writeThumbnailExport(command.args[1]);
    if (command.label === 'SQL package generator') {
      const output = command.args.find((argument) => argument.startsWith('--output-dir=')).slice('--output-dir='.length);
      for (const filename of SQL_FILES) write(path.join(output, filename), '-- candidate');
      return {
        stdout: `SQL_PACKAGE_SUMMARY ${JSON.stringify({
          playlist_count: mismatch ? 8 : 7,
          show_count: 913,
          sample_count: 37,
        })}\n`,
      };
    }
    return { stdout: '' };
  };
  return { calls, runner };
}

const silentLogger = { log() {}, warn() {} };

test('resolves configured repositories and a unique Tooling-owned staging child', (t) => {
  const expected = fixture(t);
  const paths = resolveDatasetValidationPaths(expected.toolingRoot, expected.config, 'abcdef123456');
  assert.equal(paths.serverRoot, expected.serverRoot);
  assert.equal(paths.dataRoot, expected.dataRoot);
  assert.equal(paths.validationRoot, path.join(expected.toolingRoot, 'staging/data-validation-abcdef123456'));
  assert.equal(paths.sqlRoot, path.join(paths.validationRoot, 'sql'));
  assert.notEqual(paths.sqlRoot, path.join(expected.serverRoot, 'sql'));
});

test('successful validation derives counts from manifests and cleans all candidate state', async (t) => {
  const expected = fixture(t);
  const dataBefore = treeSnapshot(expected.dataRoot);
  const mocked = mockRunner();
  const result = await validateDatasetPublication({
    toolingRoot: expected.toolingRoot,
    config: expected.config,
    commandRunner: mocked.runner,
    logger: silentLogger,
    runId: 'abcdef123456',
  });

  assert.deepEqual(result, {
    playlistCount: 7,
    showCount: 913,
    sampleShowCount: 37,
    thumbnailCount: 2,
    thumbnailBytes: 10,
  });
  const generator = mocked.calls.find((call) => call.label === 'SQL package generator');
  assert.ok(generator.args.includes('--expect-playlists=7'));
  assert.ok(generator.args.includes('--expect-shows=913'));
  const outputDirectory = generator.args.find((argument) => argument.startsWith('--output-dir=')).slice('--output-dir='.length);
  assert.match(outputDirectory, /staging[/\\]data-validation-abcdef123456[/\\]sql$/u);
  assert.notEqual(outputDirectory, path.join(expected.serverRoot, 'sql'));
  const validator = mocked.calls.find((call) => call.label === 'SQL package restore validator');
  assert.ok(validator.args.includes('--expect-sample-shows=37'));
  assert.ok(validator.args.includes(`--package-dir=${outputDirectory}`));
  assert.equal(fs.existsSync(path.dirname(outputDirectory)), false);
  assert.equal(fs.readFileSync(path.join(expected.toolingRoot, 'staging/keep.txt'), 'utf8'), 'keep');
  assert.equal(fs.readFileSync(path.join(expected.serverRoot, 'sql/canonical.sql'), 'utf8'), '-- keep');
  assert.deepEqual(treeSnapshot(expected.dataRoot), dataBefore);
});

test('Viewer/SQL count mismatch fails before restore validation and still cleans up', async (t) => {
  const expected = fixture(t);
  const mocked = mockRunner({ mismatch: true });
  await assert.rejects(
    validateDatasetPublication({
      toolingRoot: expected.toolingRoot,
      config: expected.config,
      commandRunner: mocked.runner,
      logger: silentLogger,
      runId: 'abcdef123456',
    }),
    /Viewer\/SQL cross-check.*artifact counts disagree/su,
  );
  assert.equal(mocked.calls.some((call) => call.label === 'SQL package restore validator'), false);
  assert.equal(fs.existsSync(path.join(expected.toolingRoot, 'staging/data-validation-abcdef123456')), false);
});

for (const [name, label, expectedStage] of [
  ['exporter', 'Server Data exporter', 'Viewer/data export'],
  ['SQL generation', 'SQL package generator', 'SQL generation'],
  ['SQL restore validation', 'SQL package restore validator', 'SQL restore validation'],
]) {
  test(`${name} failure is reported and temporary state is cleaned`, async (t) => {
    const expected = fixture(t);
    const dataBefore = treeSnapshot(expected.dataRoot);
    const mocked = mockRunner({ failLabel: label });
    await assert.rejects(
      validateDatasetPublication({
        toolingRoot: expected.toolingRoot,
        config: expected.config,
        commandRunner: mocked.runner,
        logger: silentLogger,
        runId: 'abcdef123456',
      }),
      new RegExp(expectedStage),
    );
    assert.equal(fs.existsSync(path.join(expected.toolingRoot, 'staging/data-validation-abcdef123456')), false);
    assert.deepEqual(treeSnapshot(expected.dataRoot), dataBefore);
  });
}

test('unsafe repository configuration is rejected before staging is changed', (t) => {
  const expected = fixture(t);
  const unsafe = { ...expected.config, repos: { ...expected.config.repos, server: '.' } };
  assert.throws(
    () => resolveDatasetValidationPaths(expected.toolingRoot, unsafe, 'abcdef123456'),
    /Server repository resolves to an unsafe path/u,
  );
  assert.equal(fs.readFileSync(path.join(expected.toolingRoot, 'staging/keep.txt'), 'utf8'), 'keep');
});

test('symbolic-link repository configuration is rejected', { skip: process.platform === 'win32' }, (t) => {
  const expected = fixture(t);
  const link = path.join(expected.root, 'server-link');
  fs.symlinkSync(expected.serverRoot, link, 'dir');
  const unsafe = { ...expected.config, repos: { ...expected.config.repos, server: '../server-link' } };
  assert.throws(
    () => resolveDatasetValidationPaths(expected.toolingRoot, unsafe, 'abcdef123456'),
    /missing or is not a directory|symbolic link/u,
  );
});

