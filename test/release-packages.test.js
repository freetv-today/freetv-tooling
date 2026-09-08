import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  RELEASE_PACKAGES,
  buildReleasePackages,
  isSafePackagePath,
  validatePackageDirectory,
  validateReleaseArchive,
} from '../scripts/lib/release-packages.js';

const GENERATED_AT = '2026-09-08T12:34:56.000Z';

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeJson(filePath, value) {
  write(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sqlString(value) {
  if (value === null) return 'NULL';
  if (Number.isInteger(value)) return String(value);
  return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
}

function insert(table, columns, rows) {
  return `INSERT INTO ${table} (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES\n  ${rows
    .map((row) => `(${columns.map((column) => sqlString(row[column] ?? null)).join(', ')})`)
    .join(',\n  ')};\n`;
}

function sqlPackage(playlists, shows) {
  const playlistColumns = [
    'id', 'filename', 'dbtitle', 'dbversion', 'author', 'email', 'link', 'lastupdated',
    'is_default', 'sort_order',
  ];
  const showColumns = [
    'playlist_id', 'category', 'status', 'identifier', 'title', 'description', 'start_year',
    'end_year', 'imdb', 'group_name', 'sort_order',
  ];
  return [
    '-- fixture tables-only SQL',
    'CREATE TABLE IF NOT EXISTS playlists (id INT);',
    'CREATE TABLE IF NOT EXISTS playlist_shows (playlist_id INT);',
    insert('playlists', playlistColumns, playlists),
    insert('playlist_shows', showColumns, shows),
  ].join('\n');
}

function show(identifier, title, imdb = null) {
  return {
    category: 'archive', status: 'active', identifier, title, desc: `${title} description`,
    start: '2000', end: '2001', imdb,
  };
}

function sqlShow(playlistId, value, sortOrder) {
  return {
    playlist_id: playlistId,
    category: value.category,
    status: value.status,
    identifier: value.identifier,
    title: value.title,
    description: value.desc,
    start_year: value.start,
    end_year: value.end,
    imdb: value.imdb,
    group_name: null,
    sort_order: sortOrder,
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-release-packages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const toolingRoot = path.join(root, 'freetv-tooling');
  const dataRoot = path.join(root, 'freetv-data');
  fs.mkdirSync(toolingRoot);
  fs.mkdirSync(path.join(dataRoot, 'playlists'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'thumbs'));

  const alphaShows = [show('alpha-one', 'Alpha One', 'tt0000001'), show('alpha-two', 'Alpha Two')];
  const betaShows = [show('beta-one', 'Beta One', 'tt0000002')];
  const playlists = [
    {
      id: 1, filename: 'alpha.json', dbtitle: 'Alpha', dbversion: '1', author: 'FreeTV',
      email: null, link: null, lastupdated: '2026-09-08 12:00:00', is_default: 1, sort_order: 0,
    },
    {
      id: 2, filename: 'beta.json', dbtitle: 'Beta', dbversion: '1', author: 'FreeTV',
      email: null, link: null, lastupdated: '2026-09-08 12:00:00', is_default: 0, sort_order: 1,
    },
  ];
  const fullShows = [
    sqlShow(1, alphaShows[0], 0), sqlShow(1, alphaShows[1], 1), sqlShow(2, betaShows[0], 0),
  ];
  const sampleShows = [sqlShow(1, alphaShows[0], 0), sqlShow(2, betaShows[0], 0)];

  writeJson(path.join(dataRoot, 'config.json'), { lastupdated: GENERATED_AT, show_ads: false });
  writeJson(path.join(dataRoot, 'playlists/index.json'), {
    default: 'alpha.json',
    playlists: [
      { filename: 'alpha.json', dbtitle: 'Alpha', lastupdated: GENERATED_AT, author: 'FreeTV' },
      { filename: 'beta.json', dbtitle: 'Beta', lastupdated: GENERATED_AT, author: 'FreeTV' },
    ],
  });
  writeJson(path.join(dataRoot, 'playlists/alpha.json'), {
    lastupdated: GENERATED_AT, dbtitle: 'Alpha', dbversion: '1', author: 'FreeTV',
    email: null, link: null, shows: alphaShows,
  });
  writeJson(path.join(dataRoot, 'playlists/beta.json'), {
    lastupdated: GENERATED_AT, dbtitle: 'Beta', dbversion: '1', author: 'FreeTV',
    email: null, link: null, shows: betaShows,
  });
  write(path.join(dataRoot, 'thumbs/tt0000001.jpg'), 'alpha thumbnail');
  write(path.join(dataRoot, 'thumbs/tt0000002.jpg'), 'beta thumbnail');
  write(path.join(dataRoot, RELEASE_PACKAGES.sample.sql), sqlPackage(playlists, sampleShows));
  write(path.join(dataRoot, RELEASE_PACKAGES.official.sql), sqlPackage(playlists, fullShows));
  writeJson(path.join(dataRoot, 'manifest.json'), {
    format_version: 1,
    generated_at: GENERATED_AT,
    reconciled_snapshot: { name: 'fixture', captured_at: GENERATED_AT },
    counts: { playlists: 2, shows: 3, sample_shows: 2, thumbnails: 2 },
  });

  return {
    root,
    toolingRoot,
    dataRoot,
    config: {
      repos: { data: '../freetv-data' },
      staging: { root: 'staging', data: 'data', thumbnails: 'thumbnails' },
    },
  };
}

function unzip(archivePath, destination) {
  fs.mkdirSync(destination);
  const result = spawnSync('unzip', ['-qq', archivePath, '-d', destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('builds and independently validates root-level Sample and Official release ZIPs', async (t) => {
  const expected = fixture(t);
  const result = await buildReleasePackages({
    toolingRoot: expected.toolingRoot,
    config: expected.config,
    runId: 'abcdef123456',
    clock: () => new Date(GENERATED_AT),
    logger: { log() {} },
  });

  for (const dataset of ['sample', 'official']) {
    const archivePath = result[dataset].archivePath;
    assert.equal(fs.existsSync(archivePath), true);
    const listing = spawnSync('unzip', ['-Z1', archivePath], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr);
    const entries = listing.stdout.trim().split(/\r?\n/u);
    assert.equal(entries.includes('manifest.json'), true);
    assert.equal(entries.includes('database.sql'), true);
    assert.equal(entries.includes('config.json'), true);
    assert.equal(entries.includes('playlists/'), true);
    assert.equal(entries.includes('thumbs/'), true);
    assert.equal(entries.some((entry) => entry.startsWith(`${dataset}/`)), false);

    const validation = validateReleaseArchive({
      archivePath,
      expectedDataset: dataset,
      extractionRoot: path.join(expected.root, `verify-${dataset}`),
      canonicalCounts: result[dataset].expectedCounts,
    });
    assert.equal(validation.manifest.format_version, 1);
    assert.equal(validation.manifest.dataset, dataset);
  }

  assert.deepEqual(result.sample.expectedCounts, { playlists: 2, shows: 2 });
  assert.deepEqual(result.official.expectedCounts, { playlists: 2, shows: 3 });
  assert.equal(
    fs.existsSync(path.join(expected.toolingRoot, 'staging/release-packages-abcdef123456')),
    false,
  );
});

test('directory validation rejects missing, extra, and hash-mismatched payload', async (t) => {
  const expected = fixture(t);
  const result = await buildReleasePackages({
    toolingRoot: expected.toolingRoot,
    config: expected.config,
    runId: '123456abcdef',
    clock: () => new Date(GENERATED_AT),
    logger: { log() {} },
  });
  const original = path.join(expected.root, 'original');
  unzip(result.sample.archivePath, original);

  const missing = path.join(expected.root, 'missing');
  fs.cpSync(original, missing, { recursive: true });
  fs.rmSync(path.join(missing, 'database.sql'));
  assert.throws(() => validatePackageDirectory(missing, 'sample'), /missing required database.sql/u);

  const extra = path.join(expected.root, 'extra');
  fs.cpSync(original, extra, { recursive: true });
  writeJson(path.join(extra, 'playlists/extra.json'), { shows: [] });
  assert.throws(() => validatePackageDirectory(extra, 'sample'), /inventory does not exactly match/u);

  const mismatch = path.join(expected.root, 'mismatch');
  fs.cpSync(original, mismatch, { recursive: true });
  write(path.join(mismatch, 'config.json'), '{}');
  assert.throws(() => validatePackageDirectory(mismatch, 'sample'), /SHA-256 mismatch/u);

  const inconsistent = path.join(expected.root, 'inconsistent');
  fs.cpSync(original, inconsistent, { recursive: true });
  const playlistPath = path.join(inconsistent, 'playlists/alpha.json');
  const playlist = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
  playlist.shows[0].title = 'Different title';
  writeJson(playlistPath, playlist);
  const manifestPath = path.join(inconsistent, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files['playlists/alpha.json'] = crypto.createHash('sha256')
    .update(fs.readFileSync(playlistPath)).digest('hex');
  writeJson(manifestPath, manifest);
  assert.throws(() => validatePackageDirectory(inconsistent, 'sample'), /disagrees on title/u);
});

test('rejects unsafe package paths', () => {
  for (const unsafe of ['../escape.json', '/absolute.json', 'C:\\escape.json', 'playlists\\bad.json']) {
    assert.equal(isSafePackagePath(unsafe), false, unsafe);
  }
  assert.equal(isSafePackagePath('playlists/valid.json'), true);
});

test('a generation failure preserves existing release ZIPs', async (t) => {
  const expected = fixture(t);
  const releasesRoot = path.join(expected.dataRoot, 'releases');
  fs.mkdirSync(releasesRoot);
  const samplePath = path.join(releasesRoot, RELEASE_PACKAGES.sample.archive);
  const officialPath = path.join(releasesRoot, RELEASE_PACKAGES.official.archive);
  write(samplePath, 'known-good-sample');
  write(officialPath, 'known-good-official');
  fs.rmSync(path.join(expected.dataRoot, RELEASE_PACKAGES.official.sql));

  await assert.rejects(() => buildReleasePackages({
    toolingRoot: expected.toolingRoot,
    config: expected.config,
    runId: 'fedcba654321',
    clock: () => new Date(GENERATED_AT),
    logger: { log() {} },
  }), /Canonical official tables-only SQL is missing/u);
  assert.equal(fs.readFileSync(samplePath, 'utf8'), 'known-good-sample');
  assert.equal(fs.readFileSync(officialPath, 'utf8'), 'known-good-official');
  assert.equal(
    fs.existsSync(path.join(expected.toolingRoot, 'staging/release-packages-fedcba654321')),
    false,
  );
});
