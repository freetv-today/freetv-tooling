import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareContent,
  formatComparisonReport,
  loadLocalDataset,
  loadProductionSnapshot,
  resolveLocalDataPath,
} from '../scripts/lib/content-comparison.js';

const SNAPSHOT_NAME = 'freetv-content-snapshot-20260828T192021Z';
const SNAPSHOT_AT = '2026-08-28T19:20:21.000Z';

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freetv-content-comparison-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function hash(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function metadata(root, relative) {
  const contents = fs.readFileSync(path.join(root, relative));
  return { path: relative, sha256: hash(contents), bytes: contents.length };
}

function basePlaylists() {
  return [{
    id: 101,
    filename: 'alpha.json',
    dbtitle: 'Alpha',
    dbversion: '1.0',
    author: 'Free TV',
    email: 'support@example.test',
    link: 'https://example.test',
    lastupdated: '2026-08-28 19:20:21',
    is_default: 1,
    sort_order: 0,
  }];
}

function baseShows() {
  return [
    {
      id: 501,
      playlist_id: 101,
      category: 'comedy',
      status: 'active',
      identifier: 'alpha-one',
      title: 'Alpha One',
      description: 'First show',
      start_year: '2001',
      end_year: '2002',
      imdb: 'tt0000001',
      group_name: null,
      sort_order: 0,
    },
    {
      id: 502,
      playlist_id: 101,
      category: 'drama',
      status: 'active',
      identifier: 'alpha-two',
      title: 'Alpha Two',
      description: 'Second show',
      start_year: '2003',
      end_year: '2004',
      imdb: 'tt0000002',
      group_name: 'Alpha Group',
      sort_order: 1,
    },
  ];
}

function writeSnapshot(appRoot, options = {}) {
  const root = path.join(appRoot, SNAPSHOT_NAME);
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
  const playlists = options.playlists ?? basePlaylists();
  const shows = options.shows ?? baseShows();
  const thumbnails = options.thumbnails ?? {
    'tt0000001.jpg': 'thumbnail one',
    'tt0000002.jpg': 'thumbnail two',
  };
  writeJson(path.join(root, 'playlists.json'), playlists);
  writeJson(path.join(root, 'playlist_shows.json'), shows);
  for (const [filename, contents] of Object.entries(thumbnails)) {
    fs.writeFileSync(path.join(root, 'thumbs', filename), contents);
  }
  const thumbnailPaths = Object.keys(thumbnails).sort().map((filename) => `thumbs/${filename}`);
  writeJson(path.join(root, 'thumbs-manifest.json'), {
    format_version: 1,
    files: thumbnailPaths.map((relative) => metadata(root, relative)),
  });
  writeJson(path.join(root, 'manifest.json'), {
    format_version: 1,
    production_snapshot_at: SNAPSHOT_AT,
    capture_completed_at: SNAPSHOT_AT,
    counts: {
      playlists: playlists.length,
      shows: shows.length,
      thumbnails: thumbnailPaths.length,
      ...(options.counts ?? {}),
    },
    files: ['playlists.json', 'playlist_shows.json', 'thumbs-manifest.json']
      .map((relative) => metadata(root, relative)),
  });
  return root;
}

function localPlaylistFromProduction(playlist, shows) {
  return {
    lastupdated: SNAPSHOT_AT,
    filename: playlist.filename,
    dbtitle: playlist.dbtitle,
    dbversion: playlist.dbversion,
    author: playlist.author,
    email: playlist.email,
    link: playlist.link,
    shows: shows.map((show) => ({
      category: show.category,
      status: show.status,
      identifier: show.identifier,
      title: show.title,
      desc: show.description,
      start: show.start_year,
      end: show.end_year,
      imdb: show.imdb,
      ...(show.group_name === null ? {} : { group: show.group_name }),
    })),
  };
}

function writeLocalData(appRoot, options = {}) {
  const root = path.join(appRoot, 'freetv-data');
  fs.mkdirSync(path.join(root, 'playlists'), { recursive: true });
  fs.mkdirSync(path.join(root, 'thumbs'), { recursive: true });
  const productionPlaylists = options.productionPlaylists ?? basePlaylists();
  const productionShows = options.productionShows ?? baseShows();
  const playlists = options.playlists ?? productionPlaylists.map((playlist) => ({
    filename: playlist.filename,
    data: localPlaylistFromProduction(
      playlist,
      productionShows.filter((show) => show.playlist_id === playlist.id),
    ),
  }));
  const defaultFilename = options.defaultFilename ?? playlists[0]?.filename;
  writeJson(path.join(root, 'playlists', 'index.json'), {
    default: defaultFilename,
    playlists: playlists.map(({ filename, data }) => ({
      filename,
      dbtitle: data.dbtitle,
      lastupdated: data.lastupdated,
      author: data.author,
    })),
  });
  for (const { filename, data } of playlists) writeJson(path.join(root, 'playlists', filename), data);
  const thumbnails = options.thumbnails ?? {
    'tt0000001.jpg': 'thumbnail one',
    'tt0000002.jpg': 'thumbnail two',
  };
  for (const [filename, contents] of Object.entries(thumbnails)) {
    fs.writeFileSync(path.join(root, 'thumbs', filename), contents);
  }
  const showCount = playlists.reduce((sum, playlist) => sum + playlist.data.shows.length, 0);
  writeJson(path.join(root, 'manifest.json'), {
    format_version: 1,
    production_snapshot_at: SNAPSHOT_AT,
    generated_at: SNAPSHOT_AT,
    counts: {
      playlists: playlists.length,
      shows: showCount,
      thumbnails: Object.keys(thumbnails).length,
    },
  });
  return root;
}

function comparisonFixture(t, snapshotOptions = {}, localOptions = {}) {
  const root = temporaryRoot(t);
  const snapshotRoot = writeSnapshot(root, snapshotOptions);
  const dataRoot = writeLocalData(root, localOptions);
  return {
    root,
    snapshotRoot,
    dataRoot,
    compare() {
      return compareContent(loadProductionSnapshot(snapshotRoot), loadLocalDataset(dataRoot));
    },
  };
}

function summary(comparison) {
  return Object.fromEntries(['playlists', 'shows', 'thumbnails'].map((kind) => [kind, {
    productionOnly: comparison[kind].productionOnly.length,
    localOnly: comparison[kind].localOnly.length,
    changed: comparison[kind].changed.length,
  }]));
}

test('identical logical content ignores differing database numeric IDs and does not write', (t) => {
  const fixture = comparisonFixture(t);
  const beforeSnapshot = hash(fs.readFileSync(path.join(fixture.snapshotRoot, 'manifest.json')));
  const beforeLocal = hash(fs.readFileSync(path.join(fixture.dataRoot, 'playlists/alpha.json')));
  const comparison = fixture.compare();
  assert.deepEqual(summary(comparison), {
    playlists: { productionOnly: 0, localOnly: 0, changed: 0 },
    shows: { productionOnly: 0, localOnly: 0, changed: 0 },
    thumbnails: { productionOnly: 0, localOnly: 0, changed: 0 },
  });
  assert.match(formatComparisonReport(comparison), /No content differences found\./u);
  assert.equal(hash(fs.readFileSync(path.join(fixture.snapshotRoot, 'manifest.json'))), beforeSnapshot);
  assert.equal(hash(fs.readFileSync(path.join(fixture.dataRoot, 'playlists/alpha.json'))), beforeLocal);
});

test('reports a production-only playlist', (t) => {
  const playlists = [...basePlaylists(), {
    ...basePlaylists()[0], id: 202, filename: 'beta.json', dbtitle: 'Beta', is_default: 0, sort_order: 1,
  }];
  const comparison = comparisonFixture(t, { playlists }).compare();
  assert.deepEqual(comparison.playlists.productionOnly, [{ filename: 'beta.json' }]);
});

test('reports a local-only playlist', (t) => {
  const beta = { ...basePlaylists()[0], id: 202, filename: 'beta.json', dbtitle: 'Beta', is_default: 0 };
  const betaLocal = localPlaylistFromProduction(beta, []);
  const localOptions = {
    playlists: [
      { filename: 'alpha.json', data: localPlaylistFromProduction(basePlaylists()[0], baseShows()) },
      { filename: 'beta.json', data: betaLocal },
    ],
  };
  const comparison = comparisonFixture(t, {}, localOptions).compare();
  assert.deepEqual(comparison.playlists.localOnly, [{ filename: 'beta.json' }]);
});

test('reports changed playlist metadata', (t) => {
  const changed = localPlaylistFromProduction(basePlaylists()[0], baseShows());
  changed.dbtitle = 'Different Alpha';
  const comparison = comparisonFixture(t, {}, {
    playlists: [{ filename: 'alpha.json', data: changed }],
  }).compare();
  assert.deepEqual(comparison.playlists.changed[0].differences, [
    { field: 'dbtitle', production: 'Alpha', local: 'Different Alpha' },
  ]);
});

test('reports a production-only show', (t) => {
  const shows = [...baseShows(), {
    ...baseShows()[0], id: 503, identifier: 'alpha-three', title: 'Alpha Three', sort_order: 2,
  }];
  const comparison = comparisonFixture(t, { shows }).compare();
  assert.deepEqual(comparison.shows.productionOnly, [{ playlist: 'alpha.json', identifier: 'alpha-three' }]);
});

test('reports a local-only show', (t) => {
  const data = localPlaylistFromProduction(basePlaylists()[0], baseShows());
  data.shows.push({ ...data.shows[0], identifier: 'alpha-three', title: 'Alpha Three' });
  const comparison = comparisonFixture(t, {}, {
    playlists: [{ filename: 'alpha.json', data }],
  }).compare();
  assert.deepEqual(comparison.shows.localOnly, [{ playlist: 'alpha.json', identifier: 'alpha-three' }]);
});

test('reports changed show content', (t) => {
  const data = localPlaylistFromProduction(basePlaylists()[0], baseShows());
  data.shows[0].imdb = 'tt9999999';
  const comparison = comparisonFixture(t, {}, {
    playlists: [{ filename: 'alpha.json', data }],
  }).compare();
  assert.deepEqual(comparison.shows.changed[0].differences, [
    { field: 'imdb', production: 'tt0000001', local: 'tt9999999' },
  ]);
});

test('reports reordered shows as meaningful ordering changes', (t) => {
  const data = localPlaylistFromProduction(basePlaylists()[0], baseShows());
  data.shows.reverse();
  const comparison = comparisonFixture(t, {}, {
    playlists: [{ filename: 'alpha.json', data }],
  }).compare();
  assert.equal(comparison.shows.changed.length, 2);
  assert.deepEqual(comparison.shows.changed.map((item) => item.differences), [
    [{ field: 'sort_order', production: 0, local: 1 }],
    [{ field: 'sort_order', production: 1, local: 0 }],
  ]);
});

test('reports production-only, local-only, and changed thumbnails by SHA-256', (t) => {
  const comparison = comparisonFixture(t, {
    thumbnails: { 'tt0000001.jpg': 'production bytes', 'tt0000002.jpg': 'production only' },
  }, {
    thumbnails: { 'tt0000001.jpg': 'local bytes', 'tt0000003.jpg': 'local only' },
  }).compare();
  assert.deepEqual(comparison.thumbnails.productionOnly, [{ filename: 'tt0000002.jpg' }]);
  assert.deepEqual(comparison.thumbnails.localOnly, [{ filename: 'tt0000003.jpg' }]);
  assert.equal(comparison.thumbnails.changed[0].filename, 'tt0000001.jpg');
  assert.equal(comparison.thumbnails.changed[0].differences[0].field, 'sha256');
});

test('rejects malformed snapshot JSON', (t) => {
  const fixture = comparisonFixture(t);
  fs.writeFileSync(path.join(fixture.snapshotRoot, 'manifest.json'), '{invalid');
  assert.throws(() => loadProductionSnapshot(fixture.snapshotRoot), /invalid JSON/u);
});

test('rejects invalid snapshot manifest counts', (t) => {
  const fixture = comparisonFixture(t, { counts: { shows: 999 } });
  assert.throws(() => loadProductionSnapshot(fixture.snapshotRoot), /counts do not match/u);
});

test('rejects corrupt snapshot artifact hashes', (t) => {
  const fixture = comparisonFixture(t);
  const playlistPath = path.join(fixture.snapshotRoot, 'playlists.json');
  const playlists = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
  playlists[0].dbtitle = 'Corrupted after manifest creation';
  writeJson(playlistPath, playlists);
  assert.throws(() => loadProductionSnapshot(fixture.snapshotRoot), /byte size mismatch|SHA-256 mismatch/u);
});

test('report detail ordering is deterministic', (t) => {
  const data = localPlaylistFromProduction(basePlaylists()[0], baseShows());
  data.shows.push(
    { ...data.shows[0], identifier: 'zeta-show' },
    { ...data.shows[0], identifier: 'beta-show' },
  );
  const fixture = comparisonFixture(t, {}, { playlists: [{ filename: 'alpha.json', data }] });
  const report = formatComparisonReport(fixture.compare());
  assert.ok(report.indexOf('alpha.json / beta-show') < report.indexOf('alpha.json / zeta-show'));
  assert.equal(report, formatComparisonReport(fixture.compare()));
});

test('loads a validated ZIP snapshot directly through the unzip command contract', (t) => {
  const root = temporaryRoot(t);
  const snapshotRoot = writeSnapshot(root);
  const archive = path.join(root, 'snapshot.zip');
  fs.writeFileSync(archive, 'ZIP fixture is read through the injected command seam');
  const relativeEntries = [];
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        relativeEntries.push(`${SNAPSHOT_NAME}/${child}/`);
        walk(path.join(directory, entry.name), child);
      } else {
        relativeEntries.push(`${SNAPSHOT_NAME}/${child}`);
      }
    }
  }
  relativeEntries.push(`${SNAPSHOT_NAME}/`);
  walk(snapshotRoot);
  const commandRunner = (executable, args, options) => {
    assert.equal(executable, 'unzip');
    if (args[0] === '-Z1') {
      return { status: 0, stdout: `${relativeEntries.join('\n')}\n`, stderr: '' };
    }
    const prefix = `${SNAPSHOT_NAME}/`;
    const relative = args[2].slice(prefix.length);
    return { status: 0, stdout: fs.readFileSync(path.join(snapshotRoot, relative)), stderr: Buffer.alloc(0) };
  };
  const snapshot = loadProductionSnapshot(archive, { commandRunner });
  assert.equal(snapshot.name, SNAPSHOT_NAME);
  assert.equal(snapshot.playlists.size, 1);
  assert.equal(snapshot.shows.size, 2);
  assert.equal(snapshot.thumbnails.size, 2);
});

test('resolves freetv-data through the configured sibling-repository contract', () => {
  assert.equal(
    resolveLocalDataPath('/workspace/freetv-tooling', { repos: { data: '../freetv-data' } }),
    path.resolve('/workspace/freetv-data'),
  );
  assert.throws(() => resolveLocalDataPath('/workspace/freetv-tooling', { repos: {} }),
    /config\.repos\.data/u);
});
