import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalDataset, resolveLocalDataPath } from './content-comparison.js';
import { resetStaging, resolveStagingPaths } from './export-staging.js';

export const RELEASE_PACKAGES = Object.freeze({
  sample: Object.freeze({
    archive: 'freetv-sample-data.zip',
    sql: 'freetv_mariadb_sample_data-tables-only.sql',
  }),
  official: Object.freeze({
    archive: 'freetv-official-data.zip',
    sql: 'freetv_mariadb_full_data-tables-only.sql',
  }),
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const PLAYLIST_FIELDS = ['dbtitle', 'dbversion', 'author', 'email', 'link', 'is_default', 'sort_order'];
const SHOW_FIELDS = [
  'category', 'status', 'title', 'description', 'start_year', 'end_year', 'imdb', 'group_name',
  'sort_order',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function requireDirectory(directory, label) {
  if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()
    || !fs.lstatSync(directory).isDirectory()) {
    throw new Error(`${label} is missing or unsafe: ${directory}`);
  }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()
    || !fs.lstatSync(filePath).isFile()) {
    throw new Error(`${label} is missing or unsafe: ${filePath}`);
  }
}

function readJson(filePath, label) {
  requireFile(filePath, label);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

export function isSafePackagePath(value) {
  if (typeof value !== 'string' || value === '' || value.includes('\0') || value.includes('\\')
    || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'
    && /^[A-Za-z0-9._-]+$/u.test(segment));
}

function isAllowedPayloadPath(relativePath) {
  return ['database.sql', 'config.json'].includes(relativePath)
    || /^playlists\/[A-Za-z0-9_-]+\.json$/u.test(relativePath)
    || /^thumbs\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/iu.test(relativePath);
}

function listFiles(root) {
  const files = [];
  function walk(directory, relativeRoot = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(relativeRoot, entry.name).split(path.sep).join('/');
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || fs.lstatSync(absolute).isSymbolicLink()) {
        throw new Error(`Package contains a symbolic link: ${relative}`);
      }
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Package contains an unsupported entry: ${relative}`);
    }
  }
  walk(root);
  return files.sort();
}

function copyFile(source, destination, label) {
  requireFile(source, label);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++;
    else if (value[index] === ')') depth--;
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw new Error('SQL artifact contains malformed tuple syntax');
  }
  if (depth !== 0) throw new Error('SQL artifact contains malformed tuple syntax');
  parts.push(value.slice(start).trim());
  return parts;
}

function parseTuples(value) {
  const rows = [];
  let start = -1;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') {
      if (depth === 0) start = index + 1;
      depth++;
    } else if (value[index] === ')') {
      depth--;
      if (depth === 0) rows.push(value.slice(start, index));
      if (depth < 0) throw new Error('SQL artifact contains malformed row syntax');
    } else if (depth === 0 && !/[\s,]/u.test(value[index])) {
      throw new Error('SQL artifact contains unexpected text between rows');
    }
  }
  if (depth !== 0 || rows.length === 0) throw new Error('SQL artifact contains malformed rows');
  return rows;
}

function parseSqlLiteral(value) {
  if (value === 'NULL') return null;
  if (/^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
  const converted = value.match(/^CONVERT\(0x([a-f0-9]*) USING utf8mb4\)$/iu);
  if (converted) return Buffer.from(converted[1], 'hex').toString('utf8');
  throw new Error(`SQL artifact contains an unsupported literal: ${value.slice(0, 80)}`);
}

function parseInsert(sql, table) {
  const pattern = new RegExp(`INSERT INTO ${table} \\(([^;]+?)\\) VALUES\\s+([\\s\\S]*?);`, 'gu');
  const matches = [...sql.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`SQL artifact must contain exactly one ${table} insert`);
  const columns = [...matches[0][1].matchAll(/`([a-z_]+)`/gu)].map((match) => match[1]);
  if (columns.length === 0) throw new Error(`SQL artifact ${table} columns are invalid`);
  return parseTuples(matches[0][2]).map((tuple) => {
    const values = splitTopLevel(tuple).map(parseSqlLiteral);
    if (values.length !== columns.length) throw new Error(`SQL artifact ${table} row width is invalid`);
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

export function parseTablesOnlySql(contents, label = 'Dataset SQL') {
  const sql = Buffer.isBuffer(contents) ? contents.toString('utf8') : contents;
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error(`${label} is empty`);
  if (/\b(?:CREATE\s+DATABASE|USE\s+`?[^;\s]+)\b/iu.test(sql)) {
    throw new Error(`${label} is not a tables-only SQL artifact`);
  }
  const playlistRows = parseInsert(sql, 'playlists');
  const showRows = parseInsert(sql, 'playlist_shows');
  const playlistNames = new Map();
  const playlists = new Map();
  for (const row of playlistRows) {
    if (!Number.isInteger(row.id) || typeof row.filename !== 'string' || row.filename === '') {
      throw new Error(`${label} contains an invalid playlist row`);
    }
    if (playlistNames.has(row.id) || playlists.has(row.filename)) {
      throw new Error(`${label} contains duplicate playlists`);
    }
    playlistNames.set(row.id, row.filename);
    playlists.set(row.filename, row);
  }
  const shows = new Map();
  for (const row of showRows) {
    const filename = playlistNames.get(row.playlist_id);
    if (!filename || typeof row.identifier !== 'string' || row.identifier === '') {
      throw new Error(`${label} contains a show without a valid playlist or identifier`);
    }
    const key = `${filename}\0${row.identifier}`;
    if (shows.has(key)) throw new Error(`${label} contains duplicate show identities`);
    shows.set(key, { ...row, playlist: filename });
  }
  return { playlists, shows };
}

function compareRecord(expected, actual, fields, label) {
  for (const field of fields) {
    if (!Object.is(expected[field] ?? null, actual[field] ?? null)) {
      throw new Error(`${label} disagrees on ${field}`);
    }
  }
}

function validateSqlViewerConsistency(sqlDataset, viewerDataset, dataset) {
  if (sqlDataset.playlists.size !== viewerDataset.playlists.size
    || sqlDataset.shows.size !== viewerDataset.shows.size) {
    throw new Error(`${dataset} SQL and Viewer playlist/show totals disagree`);
  }
  for (const [filename, sqlPlaylist] of sqlDataset.playlists) {
    const viewerPlaylist = viewerDataset.playlists.get(filename);
    if (!viewerPlaylist) throw new Error(`${dataset} Viewer is missing SQL playlist ${filename}`);
    compareRecord(sqlPlaylist, viewerPlaylist, PLAYLIST_FIELDS, `${dataset} playlist ${filename}`);
  }
  for (const [key, sqlShow] of sqlDataset.shows) {
    const viewerShow = viewerDataset.shows.get(key);
    if (!viewerShow) {
      throw new Error(`${dataset} Viewer is missing SQL show ${sqlShow.playlist} / ${sqlShow.identifier}`);
    }
    compareRecord(
      sqlShow,
      viewerShow,
      SHOW_FIELDS,
      `${dataset} show ${sqlShow.playlist} / ${sqlShow.identifier}`,
    );
  }
}

function loadViewerDataset(root, manifestCounts = null) {
  const playlistRoot = path.join(root, 'playlists');
  const index = readJson(path.join(playlistRoot, 'index.json'), 'Package playlists/index.json');
  const config = readJson(path.join(root, 'config.json'), 'Package config.json');
  if (!isObject(config) || typeof config.lastupdated !== 'string' || typeof config.show_ads !== 'boolean'
    || !isObject(index) || typeof index.default !== 'string' || !Array.isArray(index.playlists)) {
    throw new Error('Package Viewer artifacts do not match the current contract');
  }
  const playlists = new Map();
  const shows = new Map();
  for (const [playlistOrder, entry] of index.playlists.entries()) {
    if (!isObject(entry) || typeof entry.filename !== 'string'
      || !/^[A-Za-z0-9_-]+\.json$/u.test(entry.filename) || playlists.has(entry.filename)) {
      throw new Error('Package playlist index is invalid');
    }
    const playlist = readJson(path.join(playlistRoot, entry.filename), `Package playlist ${entry.filename}`);
    if (!isObject(playlist) || !Array.isArray(playlist.shows)) {
      throw new Error(`Package playlist ${entry.filename} must contain a shows array`);
    }
    playlists.set(entry.filename, {
      ...playlist,
      is_default: index.default === entry.filename ? 1 : 0,
      sort_order: playlistOrder,
    });
    for (const [showOrder, show] of playlist.shows.entries()) {
      if (!isObject(show) || typeof show.identifier !== 'string' || show.identifier === '') {
        throw new Error(`Package playlist ${entry.filename} contains an invalid show`);
      }
      const key = `${entry.filename}\0${show.identifier}`;
      if (shows.has(key)) throw new Error(`Package Viewer contains duplicate show identity ${key}`);
      shows.set(key, {
        playlist: entry.filename,
        identifier: show.identifier,
        category: show.category ?? null,
        status: show.status ?? null,
        title: show.title ?? null,
        description: show.desc ?? null,
        start_year: show.start ?? null,
        end_year: show.end ?? null,
        imdb: show.imdb ?? null,
        group_name: show.group ?? null,
        sort_order: showOrder,
      });
    }
  }
  if (!playlists.has(index.default)) throw new Error('Package playlist index default is invalid');
  if (manifestCounts && (manifestCounts.playlists !== playlists.size || manifestCounts.shows !== shows.size)) {
    throw new Error('Package Viewer totals disagree with the canonical manifest');
  }
  return { config, index, playlists, shows };
}

function validateCanonicalData(dataRoot) {
  const canonical = loadLocalDataset(dataRoot);
  if (canonical.warnings.length > 0) throw new Error(canonical.warnings.join('; '));
  const manifest = canonical.declaredManifest;
  if (!isObject(manifest) || manifest.format_version !== 1 || !isObject(manifest.counts)
    || !Number.isInteger(manifest.counts.sample_shows) || manifest.counts.sample_shows < 0) {
    throw new Error('Canonical freetv-data manifest is invalid or missing sample_shows');
  }
  return canonical;
}

function createSampleViewer(dataRoot, payloadRoot, sampleSql) {
  copyFile(path.join(dataRoot, 'config.json'), path.join(payloadRoot, 'config.json'), 'Canonical config.json');
  copyFile(
    path.join(dataRoot, 'playlists/index.json'),
    path.join(payloadRoot, 'playlists/index.json'),
    'Canonical playlists/index.json',
  );
  const selectedThumbnails = new Set();
  for (const filename of sampleSql.playlists.keys()) {
    const sourcePath = path.join(dataRoot, 'playlists', filename);
    const playlist = readJson(sourcePath, `Canonical playlist ${filename}`);
    const sourceShows = new Map(playlist.shows.map((show) => [show.identifier, show]));
    const selected = [...sampleSql.shows.values()]
      .filter((show) => show.playlist === filename)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((show) => {
        const source = sourceShows.get(show.identifier);
        if (!source) throw new Error(`Sample SQL show is absent from canonical Viewer data: ${filename} / ${show.identifier}`);
        if (typeof source.imdb === 'string' && source.imdb !== '') selectedThumbnails.add(`${source.imdb}.jpg`);
        return source;
      });
    fs.writeFileSync(
      path.join(payloadRoot, 'playlists', filename),
      `${JSON.stringify({ ...playlist, shows: selected }, null, 2)}\n`,
      { flag: 'wx' },
    );
  }
  for (const filename of [...selectedThumbnails].sort()) {
    const source = path.join(dataRoot, 'thumbs', filename);
    if (fs.existsSync(source)) copyFile(source, path.join(payloadRoot, 'thumbs', filename), `Sample thumbnail ${filename}`);
  }
}

function createOfficialViewer(dataRoot, payloadRoot, canonical) {
  copyFile(path.join(dataRoot, 'config.json'), path.join(payloadRoot, 'config.json'), 'Canonical config.json');
  copyFile(
    path.join(dataRoot, 'playlists/index.json'),
    path.join(payloadRoot, 'playlists/index.json'),
    'Canonical playlists/index.json',
  );
  for (const filename of canonical.playlists.keys()) {
    copyFile(
      path.join(dataRoot, 'playlists', filename),
      path.join(payloadRoot, 'playlists', filename),
      `Canonical playlist ${filename}`,
    );
  }
  for (const filename of canonical.thumbnails.keys()) {
    copyFile(
      path.join(dataRoot, 'thumbs', filename),
      path.join(payloadRoot, 'thumbs', filename),
      `Canonical thumbnail ${filename}`,
    );
  }
}

function validateTimestamp(value, label) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid UTC timestamp`);
  }
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u);
  const parsed = new Date(value);
  if (parsed.getUTCFullYear() !== Number(parts[1]) || parsed.getUTCMonth() + 1 !== Number(parts[2])
    || parsed.getUTCDate() !== Number(parts[3]) || parsed.getUTCHours() !== Number(parts[4])
    || parsed.getUTCMinutes() !== Number(parts[5]) || parsed.getUTCSeconds() !== Number(parts[6])) {
    throw new Error(`${label} must be a valid UTC timestamp`);
  }
}

export function validatePackageDirectory(root, expectedDataset, canonicalCounts = null) {
  if (!Object.hasOwn(RELEASE_PACKAGES, expectedDataset)) throw new Error('Unsupported release dataset');
  requireDirectory(root, `${expectedDataset} package root`);
  requireDirectory(path.join(root, 'playlists'), `${expectedDataset} package playlists`);
  requireDirectory(path.join(root, 'thumbs'), `${expectedDataset} package thumbs`);
  const files = listFiles(root);
  for (const relative of files) {
    if (!isSafePackagePath(relative)
      || (relative !== 'manifest.json' && !isAllowedPayloadPath(relative))) {
      throw new Error(`${expectedDataset} package contains unexpected payload: ${relative}`);
    }
  }
  for (const required of ['manifest.json', 'database.sql', 'config.json', 'playlists/index.json']) {
    if (!files.includes(required)) throw new Error(`${expectedDataset} package is missing required ${required}`);
  }
  const manifest = readJson(path.join(root, 'manifest.json'), `${expectedDataset} package manifest`);
  if (!isObject(manifest) || Object.keys(manifest).sort().join('\n') !== [
    'dataset', 'files', 'format_version', 'generated_at',
  ].sort().join('\n') || manifest.format_version !== 1 || manifest.dataset !== expectedDataset
    || !isObject(manifest.files)) {
    throw new Error(`${expectedDataset} package manifest does not match the required contract`);
  }
  validateTimestamp(manifest.generated_at, `${expectedDataset} package generated_at`);
  const payload = files.filter((relative) => relative !== 'manifest.json');
  const inventory = Object.keys(manifest.files).sort();
  if (payload.join('\n') !== inventory.join('\n')) {
    throw new Error(`${expectedDataset} package manifest inventory does not exactly match its payload`);
  }
  for (const relative of inventory) {
    const expectedHash = manifest.files[relative];
    if (!isSafePackagePath(relative) || !isAllowedPayloadPath(relative)
      || typeof expectedHash !== 'string' || !SHA256_PATTERN.test(expectedHash)) {
      throw new Error(`${expectedDataset} package manifest contains an invalid file entry`);
    }
    const actualHash = sha256(fs.readFileSync(path.join(root, relative)));
    if (actualHash !== expectedHash) throw new Error(`${expectedDataset} package SHA-256 mismatch for ${relative}`);
  }
  const sql = parseTablesOnlySql(fs.readFileSync(path.join(root, 'database.sql')), `${expectedDataset} database.sql`);
  const viewer = loadViewerDataset(root, canonicalCounts);
  validateSqlViewerConsistency(sql, viewer, expectedDataset);
  return { manifest, counts: { playlists: viewer.playlists.size, shows: viewer.shows.size } };
}

function writeManifest(payloadRoot, dataset, generatedAt) {
  const payloadFiles = listFiles(payloadRoot).filter((relative) => relative !== 'manifest.json');
  const files = Object.fromEntries(payloadFiles.map((relative) => [
    relative,
    sha256(fs.readFileSync(path.join(payloadRoot, relative))),
  ]));
  const manifest = { format_version: 1, dataset, generated_at: generatedAt, files };
  fs.writeFileSync(path.join(payloadRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

function runCommand(executable, args, options, label, commandRunner = spawnSync) {
  const result = commandRunner(executable, args, { ...options, encoding: 'utf8', windowsHide: true });
  if (result.error) {
    const detail = result.error.code === 'ENOENT' ? ` '${executable}' was not found on PATH` : ` ${result.error.message}`;
    throw new Error(`${label} failed:${detail}`);
  }
  if (result.status !== 0) throw new Error(`${label} failed: ${String(result.stderr ?? '').trim()}`);
  return result.stdout;
}

function validateArchiveEntry(entry) {
  const directory = entry.endsWith('/');
  const relative = directory ? entry.slice(0, -1) : entry;
  if (!isSafePackagePath(relative)) throw new Error(`Release ZIP contains unsafe path: ${entry}`);
  if (directory) {
    if (!['playlists', 'thumbs'].includes(relative)) throw new Error(`Release ZIP contains unexpected directory: ${entry}`);
  } else if (relative !== 'manifest.json' && !isAllowedPayloadPath(relative)) {
    throw new Error(`Release ZIP contains unexpected payload: ${entry}`);
  }
}

export function validateReleaseArchive({
  archivePath,
  expectedDataset,
  extractionRoot,
  canonicalCounts = null,
  commandRunner = spawnSync,
}) {
  requireFile(archivePath, `${expectedDataset} release ZIP`);
  const listing = runCommand(
    'unzip',
    ['-Z1', archivePath],
    { maxBuffer: 8 * 1024 * 1024 },
    `${expectedDataset} ZIP inventory inspection`,
    commandRunner,
  ).split(/\r?\n/u).filter(Boolean);
  if (listing.length === 0) throw new Error(`${expectedDataset} release ZIP is empty`);
  const seen = new Set();
  const folded = new Set();
  for (const entry of listing) {
    validateArchiveEntry(entry);
    if (seen.has(entry) || folded.has(entry.toLowerCase())) {
      throw new Error(`${expectedDataset} release ZIP contains duplicate or conflicting paths`);
    }
    seen.add(entry);
    folded.add(entry.toLowerCase());
  }
  for (const required of ['manifest.json', 'database.sql', 'config.json', 'playlists/', 'thumbs/', 'playlists/index.json']) {
    if (!seen.has(required)) throw new Error(`${expectedDataset} release ZIP is missing required root entry ${required}`);
  }
  if (fs.existsSync(extractionRoot)) throw new Error(`Release extraction path already exists: ${extractionRoot}`);
  fs.mkdirSync(extractionRoot, { recursive: true });
  runCommand(
    'unzip',
    ['-qq', archivePath, '-d', extractionRoot],
    { maxBuffer: 8 * 1024 * 1024 },
    `${expectedDataset} ZIP extraction`,
    commandRunner,
  );
  return validatePackageDirectory(extractionRoot, expectedDataset, canonicalCounts);
}

function buildPackage({ dataset, dataRoot, packageRoot, generatedAt, canonical, commandRunner }) {
  const definition = RELEASE_PACKAGES[dataset];
  const payloadRoot = path.join(packageRoot, 'payload');
  fs.mkdirSync(path.join(payloadRoot, 'playlists'), { recursive: true });
  fs.mkdirSync(path.join(payloadRoot, 'thumbs'));
  const sqlSource = path.join(dataRoot, definition.sql);
  requireFile(sqlSource, `Canonical ${dataset} tables-only SQL`);
  const sql = parseTablesOnlySql(fs.readFileSync(sqlSource), `Canonical ${dataset} SQL`);
  copyFile(sqlSource, path.join(payloadRoot, 'database.sql'), `Canonical ${dataset} tables-only SQL`);
  if (dataset === 'sample') createSampleViewer(dataRoot, payloadRoot, sql);
  else createOfficialViewer(dataRoot, payloadRoot, canonical);
  writeManifest(payloadRoot, dataset, generatedAt);
  const expectedCounts = dataset === 'official'
    ? { playlists: canonical.actualCounts.playlists, shows: canonical.actualCounts.shows }
    : { playlists: canonical.actualCounts.playlists, shows: canonical.declaredManifest.counts.sample_shows };
  validatePackageDirectory(payloadRoot, dataset, expectedCounts);
  const archivePath = path.join(packageRoot, definition.archive);
  runCommand(
    'zip',
    ['-X', '-q', '-r', archivePath, 'manifest.json', 'database.sql', 'config.json', 'playlists', 'thumbs'],
    { cwd: payloadRoot, maxBuffer: 8 * 1024 * 1024 },
    `${dataset} ZIP creation`,
    commandRunner,
  );
  validateReleaseArchive({
    archivePath,
    expectedDataset: dataset,
    extractionRoot: path.join(packageRoot, 'extracted'),
    canonicalCounts: expectedCounts,
    commandRunner,
  });
  return { dataset, archivePath, expectedCounts };
}

export function promoteReleasePackages({
  packages,
  dataRoot,
  runId,
  fileSystem = fs,
  commandRunner = spawnSync,
}) {
  if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error('Release transaction ID is unsafe');
  requireDirectory(dataRoot, 'FreeTV Data repository');
  const releasesRoot = path.join(dataRoot, 'releases');
  if (fs.existsSync(releasesRoot)) requireDirectory(releasesRoot, 'FreeTV Data releases directory');
  else fileSystem.mkdirSync(releasesRoot);
  const staleTransaction = fs.readdirSync(releasesRoot)
    .find((name) => name.startsWith('.freetv-release-'));
  if (staleTransaction) {
    throw new Error(`Unresolved release transaction requires inspection: ${path.join(releasesRoot, staleTransaction)}`);
  }
  const transactionRoot = path.join(releasesRoot, `.freetv-release-${runId}`);
  if (fs.existsSync(transactionRoot)) throw new Error(`Release transaction already exists: ${transactionRoot}`);
  const preparedRoot = path.join(transactionRoot, 'new');
  const backupRoot = path.join(transactionRoot, 'old');
  fileSystem.mkdirSync(preparedRoot, { recursive: true });
  fileSystem.mkdirSync(backupRoot);
  const states = [];
  try {
    for (const item of packages) {
      const filename = RELEASE_PACKAGES[item.dataset].archive;
      const prepared = path.join(preparedRoot, filename);
      fileSystem.copyFileSync(item.archivePath, prepared);
      states.push({ filename, installed: false, backedUp: false });
      validateReleaseArchive({
        archivePath: prepared,
        expectedDataset: item.dataset,
        extractionRoot: path.join(transactionRoot, `verify-${item.dataset}`),
        canonicalCounts: item.expectedCounts,
        commandRunner,
      });
      fileSystem.rmSync(path.join(transactionRoot, `verify-${item.dataset}`), {
        recursive: true,
        force: true,
      });
    }
    for (const state of states) {
      const target = path.join(releasesRoot, state.filename);
      const backup = path.join(backupRoot, state.filename);
      const prepared = path.join(preparedRoot, state.filename);
      if (fileSystem.existsSync(target)) {
        fileSystem.renameSync(target, backup);
        state.backedUp = true;
      }
      fileSystem.renameSync(prepared, target);
      state.installed = true;
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const state of [...states].reverse()) {
      try {
        const target = path.join(releasesRoot, state.filename);
        const backup = path.join(backupRoot, state.filename);
        if (state.installed && fileSystem.existsSync(target)) fileSystem.renameSync(target, path.join(preparedRoot, state.filename));
        if (state.backedUp && fileSystem.existsSync(backup)) fileSystem.renameSync(backup, target);
      } catch (rollbackError) {
        rollbackFailures.push(`${state.filename}: ${rollbackError.message}`);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new Error(`Release promotion failed and rollback was incomplete: ${rollbackFailures.join('; ')}`, { cause: error });
    }
    fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
    throw new Error(`Release promotion failed and was rolled back: ${error.message}`, { cause: error });
  }
  try {
    fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Release packages were promoted, but transaction cleanup failed; inspect ${transactionRoot}: ${error.message}`,
      { cause: error },
    );
  }
  return Object.fromEntries(states.map((state) => [
    state.filename.startsWith('freetv-sample') ? 'sample' : 'official',
    path.join(releasesRoot, state.filename),
  ]));
}

export async function buildReleasePackages({
  toolingRoot,
  config,
  logger = console,
  runId = crypto.randomBytes(6).toString('hex'),
  clock = () => new Date(),
  commandRunner = spawnSync,
  promoter = promoteReleasePackages,
} = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  requireDirectory(resolvedToolingRoot, 'FreeTV Tooling repository');
  if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error('Release build ID is unsafe');
  const dataRoot = resolveLocalDataPath(resolvedToolingRoot, config);
  requireDirectory(dataRoot, 'FreeTV Data repository');
  const staging = resolveStagingPaths(resolvedToolingRoot, config);
  if (dataRoot === resolvedToolingRoot || isWithin(dataRoot, staging.ownedRoot, true)
    || isWithin(staging.ownedRoot, dataRoot, true)) {
    throw new Error('FreeTV Data and Tooling staging paths are unsafe or overlapping');
  }
  const stagingRoot = path.join(staging.stagingRoot, `release-packages-${runId}`);
  if (!isWithin(stagingRoot, staging.stagingRoot)) throw new Error('Release staging path is unsafe');
  const generatedAt = clock().toISOString();
  validateTimestamp(generatedAt, 'Release generated_at');
  let failure;
  let result;
  try {
    const canonical = validateCanonicalData(dataRoot);
    fs.mkdirSync(stagingRoot, { recursive: true });
    const packages = [];
    for (const dataset of ['sample', 'official']) {
      logger.log(`Building and validating ${dataset} release package...`);
      packages.push(buildPackage({
        dataset,
        dataRoot,
        packageRoot: path.join(stagingRoot, dataset),
        generatedAt,
        canonical,
        commandRunner,
      }));
    }
    const promoted = promoter({ packages, dataRoot, runId, commandRunner });
    result = {
      sample: { ...packages[0], archivePath: promoted.sample },
      official: { ...packages[1], archivePath: promoted.official },
    };
  } catch (error) {
    failure = error;
  }
  try {
    if (fs.existsSync(stagingRoot)) resetStaging(stagingRoot, staging.ownedRoot);
  } catch (error) {
    failure = new Error(failure ? `${failure.message}; staging cleanup also failed: ${error.message}`
      : `Release packages were promoted, but staging cleanup failed: ${error.message}`, { cause: error });
  }
  if (failure) throw failure;
  return result;
}
