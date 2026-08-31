import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MANAGED_PUBLICATION_PATHS,
  SQL_PACKAGE_FILES,
  createPublicationCandidate,
  promotePublicationCandidate,
  publishDataset,
} from '../scripts/lib/data-publication.js';
import { runDataPublishCli } from '../scripts/data-publish.js';

const RUN_ID = 'abcdef123456';
const GENERATED_AT = '2026-08-30T12:34:56.000Z';
const SNAPSHOT_AT = '2026-08-29T12:04:45.000Z';
const SNAPSHOT_NAME = 'freetv-content-snapshot-20260829T120445Z';

function write(filePath, contents = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeJson(filePath, value) {
  write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function metadata(root, relativePath) {
  const contents = fs.readFileSync(path.join(root, relativePath));
  return {
    path: relativePath,
    sha256: crypto.createHash('sha256').update(contents).digest('hex'),
    bytes: contents.length,
  };
}

function treeSnapshot(root) {
  const entries = [];
  function visit(directory, relativeRoot = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = path.join(relativeRoot, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`directory:${relative}`);
        visit(absolute, relative);
      } else if (entry.isSymbolicLink()) {
        entries.push(`symlink:${relative}:${fs.readlinkSync(absolute)}`);
      } else {
        entries.push(`file:${relative}:${fs.readFileSync(absolute, 'utf8')}`);
      }
    }
  }
  visit(root);
  return entries;
}

function writeSnapshot(parent) {
  const root = path.join(parent, SNAPSHOT_NAME);
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
  const playlists = [{
    id: 9, filename: 'old.json', dbtitle: 'Old', dbversion: '1', author: 'FreeTV',
    email: null, link: null, lastupdated: SNAPSHOT_AT, is_default: 1, sort_order: 0,
  }];
  const shows = [{
    id: 10, playlist_id: 9, category: 'archive', status: 'active', identifier: 'old-show',
    title: 'Old show', description: '', start_year: null, end_year: null, imdb: 'tt0000009',
    group_name: null, sort_order: 0,
  }];
  writeJson(path.join(root, 'playlists.json'), playlists);
  writeJson(path.join(root, 'playlist_shows.json'), shows);
  write(path.join(root, 'thumbs/tt0000009.jpg'), 'snapshot thumbnail');
  writeJson(path.join(root, 'thumbs-manifest.json'), {
    format_version: 1,
    files: [metadata(root, 'thumbs/tt0000009.jpg')],
  });
  writeJson(path.join(root, 'manifest.json'), {
    format_version: 1,
    production_snapshot_at: SNAPSHOT_AT,
    capture_completed_at: SNAPSHOT_AT,
    counts: { playlists: 1, shows: 1, thumbnails: 1 },
    files: ['playlists.json', 'playlist_shows.json', 'thumbs-manifest.json']
      .map((relative) => metadata(root, relative)),
  });
  return root;
}

function writeArtifacts(paths) {
  const dataRoot = paths.dataExportRoot;
  const thumbnailRoot = paths.thumbnailExportRoot;
  writeJson(path.join(dataRoot, 'config.json'), { show_ads: false });
  writeJson(path.join(dataRoot, 'playlists/index.json'), {
    default: 'alpha.json',
    playlists: [{ filename: 'alpha.json', dbtitle: 'Alpha', lastupdated: GENERATED_AT, author: 'FreeTV' }],
  });
  writeJson(path.join(dataRoot, 'playlists/alpha.json'), {
    filename: 'alpha.json',
    dbtitle: 'Alpha',
    dbversion: '2',
    author: 'FreeTV',
    lastupdated: GENERATED_AT,
    shows: [
      { identifier: 'alpha-one', title: 'Alpha One', imdb: 'tt0000001' },
      { identifier: 'alpha-two', title: 'Alpha Two' },
    ],
  });
  const dataFiles = ['config.json', 'playlists/index.json', 'playlists/alpha.json'];
  const dataManifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: { playlist_count: 1, show_count: 2 },
    files: dataFiles.map((relative) => metadata(dataRoot, relative)),
  };
  write(path.join(thumbnailRoot, 'thumbs/tt0000001.jpg'), 'current thumbnail');
  const thumbnailFiles = ['thumbs/tt0000001.jpg'];
  const thumbnailManifest = {
    contract_version: 1,
    server_revision: 'a'.repeat(40),
    dataset: {
      thumbnail_count: 1,
      total_bytes: fs.statSync(path.join(thumbnailRoot, thumbnailFiles[0])).size,
    },
    files: thumbnailFiles.map((relative) => metadata(thumbnailRoot, relative)),
  };
  fs.mkdirSync(paths.sqlRoot, { recursive: true });
  for (const filename of SQL_PACKAGE_FILES) write(path.join(paths.sqlRoot, filename), `-- ${filename}\n`);
  return {
    dataManifest,
    thumbnailManifest,
    sqlSummary: { playlist_count: 1, show_count: 2, sample_count: 1 },
    paths: { dataRoot, thumbnailRoot },
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-data-publication-'));
  const toolingRoot = path.join(root, 'tooling');
  const serverRoot = path.join(root, 'server');
  const dataRoot = path.join(root, 'data');
  for (const tool of [
    'export-viewer-data.php', 'export-thumbnails.php', 'generate-sql-packages.php',
    'validate-sql-packages.php',
  ]) write(path.join(serverRoot, 'tools', tool), '<?php');
  write(path.join(serverRoot, 'sql/canonical.sql'), '-- canonical');
  write(path.join(toolingRoot, 'staging/keep.txt'), 'keep');
  write(path.join(dataRoot, '.git/HEAD'), 'ref: refs/heads/main\n');
  write(path.join(dataRoot, 'README.md'), 'preserve docs');
  write(path.join(dataRoot, 'logs/audit.log'), 'preserve logs');
  write(path.join(dataRoot, 'config.json'), '{"stale":true}\n');
  write(path.join(dataRoot, 'playlists/stale.json'), '{"stale":true}\n');
  write(path.join(dataRoot, 'thumbs/stale.jpg'), 'stale thumbnail');
  write(path.join(dataRoot, 'manifest.json'), '{"format_version":1,"counts":{}}\n');
  for (const filename of SQL_PACKAGE_FILES) write(path.join(dataRoot, filename), '-- stale\n');
  const snapshotRoot = writeSnapshot(root);
  const config = {
    repos: { server: '../server', data: '../data' },
    staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, toolingRoot, serverRoot, dataRoot, snapshotRoot, config };
}

function candidateFixture(t) {
  const expected = fixture(t);
  const validationRoot = path.join(expected.toolingRoot, `staging/data-validation-${RUN_ID}`);
  const paths = {
    validationRoot,
    dataExportRoot: path.join(validationRoot, 'viewer-data'),
    thumbnailExportRoot: path.join(validationRoot, 'thumbnails'),
    sqlRoot: path.join(validationRoot, 'sql'),
  };
  const artifacts = writeArtifacts(paths);
  const snapshot = { name: SNAPSHOT_NAME, capturedAt: SNAPSHOT_AT, inputPath: expected.snapshotRoot };
  const candidate = createPublicationCandidate({ paths, artifacts, snapshot, generatedAt: GENERATED_AT });
  return { ...expected, paths, artifacts, snapshot, candidate };
}

test('successful publication requires the gate, records snapshot provenance, and replaces managed paths', async (t) => {
  const expected = fixture(t);
  let gatePassed = false;
  const result = await publishDataset({
    toolingRoot: expected.toolingRoot,
    config: expected.config,
    snapshotPath: expected.snapshotRoot,
    validationGate: async () => { gatePassed = true; },
    artifactGenerator: async ({ paths }) => {
      assert.equal(gatePassed, true);
      return writeArtifacts(paths);
    },
    logger: { log() {}, warn() {} },
    runId: RUN_ID,
    clock: () => new Date(GENERATED_AT),
  });

  assert.deepEqual(result.manifest, {
    format_version: 1,
    generated_at: GENERATED_AT,
    reconciled_snapshot: { name: SNAPSHOT_NAME, captured_at: SNAPSHOT_AT },
    counts: { playlists: 1, shows: 2, sample_shows: 1, thumbnails: 1 },
  });
  assert.equal(fs.existsSync(path.join(expected.dataRoot, 'playlists/stale.json')), false);
  assert.equal(fs.existsSync(path.join(expected.dataRoot, 'thumbs/stale.jpg')), false);
  assert.equal(fs.readFileSync(path.join(expected.dataRoot, 'playlists/alpha.json'), 'utf8').includes('Alpha One'), true);
  assert.equal(fs.readFileSync(path.join(expected.dataRoot, 'README.md'), 'utf8'), 'preserve docs');
  assert.equal(fs.readFileSync(path.join(expected.dataRoot, 'logs/audit.log'), 'utf8'), 'preserve logs');
  assert.equal(fs.readFileSync(path.join(expected.dataRoot, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n');
  for (const filename of SQL_PACKAGE_FILES) {
    assert.equal(fs.readFileSync(path.join(expected.dataRoot, filename), 'utf8'), `-- ${filename}\n`);
  }
  assert.equal(fs.existsSync(path.join(expected.toolingRoot, `staging/data-validation-${RUN_ID}`)), false);
  assert.equal(fs.readFileSync(path.join(expected.toolingRoot, 'staging/keep.txt'), 'utf8'), 'keep');
});

test('validation NO GO leaves freetv-data byte-for-byte unchanged and skips generation', async (t) => {
  const expected = fixture(t);
  const before = treeSnapshot(expected.dataRoot);
  let generated = false;
  await assert.rejects(
    publishDataset({
      toolingRoot: expected.toolingRoot,
      config: expected.config,
      snapshotPath: expected.snapshotRoot,
      validationGate: async () => { throw new Error('database restore failed'); },
      artifactGenerator: async () => { generated = true; },
      logger: { log() {}, warn() {} },
      runId: RUN_ID,
    }),
    /Mandatory validation gate returned NO GO.*database restore failed/su,
  );
  assert.equal(generated, false);
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('invalid snapshot is rejected without running the gate or changing freetv-data', async (t) => {
  const expected = fixture(t);
  const before = treeSnapshot(expected.dataRoot);
  let gateRan = false;
  await assert.rejects(
    publishDataset({
      toolingRoot: expected.toolingRoot,
      config: expected.config,
      snapshotPath: path.join(expected.root, 'missing-snapshot'),
      validationGate: async () => { gateRan = true; },
      logger: { log() {}, warn() {} },
      runId: RUN_ID,
    }),
    /snapshot does not exist/u,
  );
  assert.equal(gateRan, false);
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('incomplete candidate fails before promotion and leaves freetv-data unchanged', (t) => {
  const expected = fixture(t);
  const validationRoot = path.join(expected.toolingRoot, `staging/data-validation-${RUN_ID}`);
  const paths = {
    validationRoot,
    dataExportRoot: path.join(validationRoot, 'viewer-data'),
    thumbnailExportRoot: path.join(validationRoot, 'thumbnails'),
    sqlRoot: path.join(validationRoot, 'sql'),
  };
  const artifacts = writeArtifacts(paths);
  fs.rmSync(path.join(paths.sqlRoot, SQL_PACKAGE_FILES[0]));
  const before = treeSnapshot(expected.dataRoot);
  assert.throws(
    () => createPublicationCandidate({
      paths,
      artifacts,
      snapshot: { name: SNAPSHOT_NAME, capturedAt: SNAPSHOT_AT },
      generatedAt: GENERATED_AT,
    }),
    /SQL package .* is missing or unsafe/u,
  );
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('candidate generation failure cleans Tooling publication state and leaves data unchanged', async (t) => {
  const expected = fixture(t);
  const before = treeSnapshot(expected.dataRoot);
  await assert.rejects(
    publishDataset({
      toolingRoot: expected.toolingRoot,
      config: expected.config,
      snapshotPath: expected.snapshotRoot,
      validationGate: async () => {},
      artifactGenerator: async ({ paths }) => {
        write(path.join(paths.validationRoot, 'partial.txt'), 'partial candidate');
        throw new Error('injected candidate failure');
      },
      logger: { log() {}, warn() {} },
      runId: RUN_ID,
    }),
    /injected candidate failure/u,
  );
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
  assert.equal(fs.existsSync(path.join(expected.toolingRoot, `staging/data-validation-${RUN_ID}`)), false);
  assert.equal(fs.readFileSync(path.join(expected.toolingRoot, 'staging/keep.txt'), 'utf8'), 'keep');
});

test('unsafe overlapping publication paths are rejected before mutation', (t) => {
  const expected = candidateFixture(t);
  const before = treeSnapshot(expected.candidate.candidateRoot);
  assert.throws(
    () => promotePublicationCandidate({
      candidateRoot: expected.candidate.candidateRoot,
      dataRoot: expected.candidate.candidateRoot,
      runId: RUN_ID,
      context: expected.candidate.context,
    }),
    /unsafe or overlapping/u,
  );
  assert.deepEqual(treeSnapshot(expected.candidate.candidateRoot), before);
});

test('SQL package corruption after restore validation is rejected before mutation', (t) => {
  const expected = candidateFixture(t);
  const before = treeSnapshot(expected.dataRoot);
  fs.appendFileSync(path.join(expected.candidate.candidateRoot, SQL_PACKAGE_FILES[0]), '-- corrupt\n');
  assert.throws(
    () => promotePublicationCandidate({
      candidateRoot: expected.candidate.candidateRoot,
      dataRoot: expected.dataRoot,
      runId: RUN_ID,
      context: expected.candidate.context,
    }),
    /SQL package changed after restore validation/u,
  );
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('unresolved prior publication transaction is rejected before mutation', (t) => {
  const expected = candidateFixture(t);
  write(path.join(expected.dataRoot, '.freetv-publication-deadbeefcafe/old/config.json'), 'recovery');
  const before = treeSnapshot(expected.dataRoot);
  assert.throws(
    () => promotePublicationCandidate({
      candidateRoot: expected.candidate.candidateRoot,
      dataRoot: expected.dataRoot,
      runId: RUN_ID,
      context: expected.candidate.context,
    }),
    /Unresolved publication transaction requires inspection/u,
  );
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('symbolic-link managed destination is rejected before mutation', { skip: process.platform === 'win32' }, (t) => {
  const expected = candidateFixture(t);
  fs.rmSync(path.join(expected.dataRoot, 'thumbs'), { recursive: true });
  fs.symlinkSync(path.join(expected.root, 'outside'), path.join(expected.dataRoot, 'thumbs'), 'dir');
  const before = treeSnapshot(expected.dataRoot);
  assert.throws(
    () => promotePublicationCandidate({
      candidateRoot: expected.candidate.candidateRoot,
      dataRoot: expected.dataRoot,
      runId: RUN_ID,
      context: expected.candidate.context,
    }),
    /must not be a symbolic link/u,
  );
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
});

test('promotion failure restores every managed path and removes transaction state', (t) => {
  const expected = candidateFixture(t);
  const before = treeSnapshot(expected.dataRoot);
  let injected = false;
  const fileSystem = {
    ...fs,
    renameSync(source, destination) {
      if (!injected && source === path.join(expected.dataRoot, `.freetv-publication-${RUN_ID}`, 'new', 'thumbs')) {
        injected = true;
        throw new Error('injected rename failure');
      }
      return fs.renameSync(source, destination);
    },
  };
  assert.throws(
    () => promotePublicationCandidate({
      candidateRoot: expected.candidate.candidateRoot,
      dataRoot: expected.dataRoot,
      runId: RUN_ID,
      context: expected.candidate.context,
      fileSystem,
    }),
    /failed and was rolled back.*injected rename failure/su,
  );
  assert.equal(injected, true);
  assert.deepEqual(treeSnapshot(expected.dataRoot), before);
  assert.equal(fs.existsSync(path.join(expected.dataRoot, `.freetv-publication-${RUN_ID}`)), false);
});

test('CLI has one mandatory snapshot contract, reports validation failure, and performs no Git behavior', async () => {
  const errors = [];
  let publisherRan = false;
  const status = await runDataPublishCli({
    args: ['--snapshot=/fixture', '--skip-validation'],
    configLoader: () => ({}),
    publisher: async () => { publisherRan = true; },
    logger: { log() {}, error: (message) => errors.push(message) },
  });
  assert.equal(status, 1);
  assert.equal(publisherRan, false);
  assert.match(errors.join('\n'), /Usage: npm run data:publish -- --snapshot=<PATH>/u);

  const source = [
    fs.readFileSync(new URL('../scripts/data-publish.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../scripts/lib/data-publication.js', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /\b(?:git|gh)\s/u);
  assert.doesNotMatch(source, /spawn|GitHub API|createRelease/u);
});

test('CLI returns nonzero and identifies mandatory validation NO GO', async () => {
  const errors = [];
  const status = await runDataPublishCli({
    args: ['--snapshot=/fixture'],
    configLoader: () => ({}),
    publisher: async () => { throw new Error('Mandatory validation gate returned NO GO: fixture'); },
    logger: { log() {}, error: (message) => errors.push(message) },
  });
  assert.equal(status, 1);
  assert.match(errors.join('\n'), /NO GO — Dataset was not published.*fixture/su);
});

test('CLI success reports local counts without implying a push or release', async () => {
  const output = [];
  const status = await runDataPublishCli({
    args: ['--snapshot=/fixture'],
    configLoader: () => ({}),
    publisher: async () => ({
      dataRoot: '/fixture/freetv-data',
      thumbnailBytes: 123,
      manifest: { counts: { playlists: 1, shows: 2, sample_shows: 1, thumbnails: 1 } },
    }),
    logger: { log: (message) => output.push(message), error() {} },
  });
  assert.equal(status, 0);
  assert.match(output.join('\n'), /Dataset published locally to freetv-data/u);
  assert.match(output.join('\n'), /Playlists:\s+1.*Shows:\s+2.*Sample shows:\s+1.*Thumbnails:\s+1/su);
  assert.match(output.join('\n'), /No Git operations, GitHub release, or deployment occurred\./u);
  assert.doesNotMatch(output.join('\n'), /pushed|released/iu);
});

test('managed publication list is exact and keeps the manifest last', () => {
  assert.deepEqual(MANAGED_PUBLICATION_PATHS, [
    'config.json', 'playlists', 'thumbs', ...SQL_PACKAGE_FILES, 'manifest.json',
  ]);
});
