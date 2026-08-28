import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SNAPSHOT_NAME_PATTERN = /^freetv-content-snapshot-(\d{8}T\d{6}Z)$/u;
const THUMBNAIL_NAME_PATTERN = /^tt\d+\.jpg$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SNAPSHOT_ROOT_FILES = [
  'manifest.json',
  'playlist_shows.json',
  'playlists.json',
  'thumbs/',
  'thumbs-manifest.json',
];
const SNAPSHOT_ARTIFACT_PATHS = ['playlists.json', 'playlist_shows.json', 'thumbs-manifest.json'];
// Filename and filename + Internet Archive identifier are the logical keys. Production-only
// database id/playlist_id and created_at/updated_at fields are intentionally not compared.
const PLAYLIST_FIELDS = [
  'dbtitle', 'dbversion', 'author', 'email', 'link', 'lastupdated', 'is_default', 'sort_order',
];
const SHOW_FIELDS = [
  'category', 'status', 'title', 'description', 'start_year', 'end_year', 'imdb', 'group_name', 'sort_order',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireDirectory(directory, label) {
  if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()
    || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is missing or is not a safe directory: ${directory}`);
  }
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()
    || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} is missing or is not a safe file: ${filePath}`);
  }
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function assertSafeArchiveEntry(entry) {
  if (entry === '' || entry.includes('\0') || entry.includes('\\')
    || path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)
    || entry.split('/').includes('..')) {
    throw new Error(`Snapshot ZIP contains an unsafe entry: ${JSON.stringify(entry)}`);
  }
}

function runUnzip(args, options = {}, commandRunner = spawnSync) {
  const result = commandRunner('unzip', args, {
    encoding: options.encoding ?? null,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error("ZIP snapshot support requires the 'unzip' command on PATH");
    }
    throw new Error(`Could not inspect snapshot ZIP: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8').trim()
      : String(result.stderr ?? '').trim();
    throw new Error(`Snapshot ZIP could not be read${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function listDirectoryEntries(root) {
  const entries = [''];
  function walk(relativeRoot) {
    const directory = path.join(root, relativeRoot);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(relativeRoot, entry.name).split(path.sep).join('/');
      const absolute = path.join(root, relativeRoot, entry.name);
      if (entry.isSymbolicLink() || fs.lstatSync(absolute).isSymbolicLink()) {
        throw new Error(`Snapshot directory contains a symbolic link: ${relative}`);
      }
      if (entry.isDirectory()) {
        entries.push(`${relative}/`);
        walk(relative);
      } else if (entry.isFile()) {
        entries.push(relative);
      } else {
        throw new Error(`Snapshot directory contains an unsupported entry: ${relative}`);
      }
    }
  }
  walk('');
  return entries.sort(compareText);
}

function directoryReader(inputPath) {
  const root = path.resolve(inputPath);
  requireDirectory(root, 'Production snapshot');
  const name = path.basename(root);
  if (!SNAPSHOT_NAME_PATTERN.test(name)) {
    throw new Error(`Snapshot directory name is invalid: ${name}`);
  }
  const entries = listDirectoryEntries(root);
  return {
    inputPath: root,
    name,
    entries,
    read(relative) {
      const filePath = path.resolve(root, relative);
      const fromRoot = path.relative(root, filePath);
      if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`)
        || path.isAbsolute(fromRoot)) {
        throw new Error(`Snapshot file path is unsafe: ${relative}`);
      }
      requireFile(filePath, `Snapshot file ${relative}`);
      return fs.readFileSync(filePath);
    },
  };
}

function zipReader(inputPath, commandRunner) {
  const archivePath = path.resolve(inputPath);
  requireFile(archivePath, 'Production snapshot ZIP');
  const listing = runUnzip(
    ['-Z1', archivePath],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    commandRunner,
  );
  const archiveEntries = listing.split(/\r?\n/u).filter((entry) => entry !== '');
  if (archiveEntries.length === 0) throw new Error('Production snapshot ZIP is empty');

  const seen = new Set();
  const roots = new Set();
  for (const entry of archiveEntries) {
    assertSafeArchiveEntry(entry);
    if (seen.has(entry)) throw new Error(`Snapshot ZIP contains a duplicate entry: ${entry}`);
    seen.add(entry);
    roots.add(entry.split('/')[0]);
  }
  if (roots.size !== 1) throw new Error('Snapshot ZIP must contain exactly one top-level directory');
  const [name] = roots;
  if (!SNAPSHOT_NAME_PATTERN.test(name) || !seen.has(`${name}/`)) {
    throw new Error('Snapshot ZIP top-level directory name is invalid');
  }
  const prefix = `${name}/`;
  if (archiveEntries.some((entry) => entry !== prefix && !entry.startsWith(prefix))) {
    throw new Error('Snapshot ZIP contains an entry outside its snapshot directory');
  }

  return {
    inputPath: archivePath,
    name,
    entries: archiveEntries.map((entry) => (entry === prefix ? '' : entry.slice(prefix.length)))
      .sort(compareText),
    read(relative, expectedBytes = null) {
      if (!seen.has(`${prefix}${relative}`)) throw new Error(`Snapshot ZIP file is missing: ${relative}`);
      const maxBuffer = Number.isInteger(expectedBytes)
        ? Math.max(expectedBytes + 1024, 1024 * 1024)
        : 32 * 1024 * 1024;
      return runUnzip(['-p', archivePath, `${prefix}${relative}`], { maxBuffer }, commandRunner);
    },
  };
}

function openSnapshot(inputPath, commandRunner) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error('A Production Content Snapshot path is required');
  }
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`Production snapshot does not exist: ${resolved}`);
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink()) throw new Error('Production snapshot path must not be a symbolic link');
  if (stats.isDirectory()) return directoryReader(resolved);
  if (stats.isFile() && path.extname(resolved).toLowerCase() === '.zip') {
    return zipReader(resolved, commandRunner);
  }
  throw new Error('Production snapshot must be a snapshot directory or ZIP file');
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function validateMetadata(reader, files, expectedPaths, label) {
  if (!Array.isArray(files) || files.length !== expectedPaths.length) {
    throw new Error(`${label} file metadata is incomplete`);
  }
  if (files.map((entry) => entry?.path).join('\n') !== expectedPaths.join('\n')) {
    throw new Error(`${label} file metadata paths are inconsistent`);
  }
  for (const [index, entry] of files.entries()) {
    const entryLabel = `${label} files[${index}]`;
    if (!isObject(entry) || !SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`${entryLabel} must contain a lowercase SHA-256 digest`);
    }
    requireNonNegativeInteger(entry.bytes, `${entryLabel}.bytes`);
    const contents = reader.read(entry.path, entry.bytes);
    if (contents.length !== entry.bytes) {
      throw new Error(`${label} byte size mismatch for ${entry.path}`);
    }
    if (sha256(contents) !== entry.sha256) {
      throw new Error(`${label} SHA-256 mismatch for ${entry.path}`);
    }
  }
}

function assertCanonicalTimestamp(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
}

function snapshotNameForTimestamp(timestamp) {
  return `freetv-content-snapshot-${timestamp.replaceAll('-', '').replaceAll(':', '').replace('.000', '')}`;
}

function requireRecordArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error(`${label} must be an array of objects`);
  }
}

export function loadProductionSnapshot(inputPath, options = {}) {
  const reader = openSnapshot(inputPath, options.commandRunner ?? spawnSync);
  const actualEntries = new Set(reader.entries);
  for (const required of ['', ...SNAPSHOT_ROOT_FILES]) {
    if (!actualEntries.has(required)) throw new Error(`Snapshot is missing required entry: ${required || reader.name}`);
  }

  const manifest = parseJson(reader.read('manifest.json'), 'Snapshot manifest.json');
  const playlists = parseJson(reader.read('playlists.json'), 'Snapshot playlists.json');
  const shows = parseJson(reader.read('playlist_shows.json'), 'Snapshot playlist_shows.json');
  const thumbnailManifest = parseJson(reader.read('thumbs-manifest.json'), 'Snapshot thumbs-manifest.json');
  if (!isObject(manifest) || manifest.format_version !== 1) {
    throw new Error('Snapshot manifest format_version must equal 1');
  }
  assertCanonicalTimestamp(manifest.production_snapshot_at, 'Snapshot production_snapshot_at');
  assertCanonicalTimestamp(manifest.capture_completed_at, 'Snapshot capture_completed_at');
  if (snapshotNameForTimestamp(manifest.production_snapshot_at) !== reader.name) {
    throw new Error('Snapshot name does not match production_snapshot_at');
  }
  if (!isObject(manifest.counts)) throw new Error('Snapshot manifest counts must be an object');
  for (const key of ['playlists', 'shows', 'thumbnails']) {
    requireNonNegativeInteger(manifest.counts[key], `Snapshot manifest counts.${key}`);
  }
  requireRecordArray(playlists, 'Snapshot playlists.json');
  requireRecordArray(shows, 'Snapshot playlist_shows.json');
  if (!isObject(thumbnailManifest) || thumbnailManifest.format_version !== 1
    || !Array.isArray(thumbnailManifest.files)) {
    throw new Error('Snapshot thumbnail manifest is invalid or unsupported');
  }

  const thumbnailPaths = thumbnailManifest.files.map((entry) => entry?.path);
  const expectedEntries = [
    '',
    'manifest.json',
    'playlist_shows.json',
    'playlists.json',
    'thumbs/',
    ...thumbnailPaths,
    'thumbs-manifest.json',
  ].sort(compareText);
  if (reader.entries.join('\n') !== expectedEntries.join('\n')) {
    throw new Error('Snapshot contains missing or unexpected files');
  }
  for (const thumbnailPath of thumbnailPaths) {
    if (typeof thumbnailPath !== 'string' || !/^thumbs\/tt\d+\.jpg$/u.test(thumbnailPath)) {
      throw new Error(`Snapshot thumbnail manifest contains an invalid path: ${thumbnailPath}`);
    }
  }
  const sortedThumbnailPaths = [...thumbnailPaths].sort(compareText);
  if (thumbnailPaths.join('\n') !== sortedThumbnailPaths.join('\n')
    || new Set(thumbnailPaths).size !== thumbnailPaths.length) {
    throw new Error('Snapshot thumbnail manifest paths must be unique and sorted');
  }
  if (manifest.counts.playlists !== playlists.length
    || manifest.counts.shows !== shows.length
    || manifest.counts.thumbnails !== thumbnailPaths.length) {
    throw new Error('Snapshot manifest counts do not match snapshot content');
  }

  validateMetadata(reader, manifest.files, SNAPSHOT_ARTIFACT_PATHS, 'Snapshot manifest');
  validateMetadata(reader, thumbnailManifest.files, thumbnailPaths, 'Snapshot thumbnail manifest');

  return normalizeProduction(reader, manifest, playlists, shows, thumbnailManifest.files);
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(String(value))
    ? `${String(value).replace(' ', 'T')}.000Z`
    : String(value);
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? String(value) : new Date(parsed).toISOString();
}

function nullable(value) {
  return value === undefined || value === null ? null : value;
}

function normalizeProduction(reader, manifest, playlistRows, showRows, thumbnailFiles) {
  const playlists = new Map();
  const playlistIds = new Map();
  for (const row of playlistRows) {
    if (!Number.isInteger(row.id) || typeof row.filename !== 'string' || row.filename === '') {
      throw new Error('Snapshot playlist is missing its database ID or logical filename');
    }
    if (playlistIds.has(row.id) || playlists.has(row.filename)) {
      throw new Error('Snapshot contains duplicate playlist identity');
    }
    playlistIds.set(row.id, row.filename);
    playlists.set(row.filename, {
      dbtitle: nullable(row.dbtitle),
      dbversion: nullable(row.dbversion),
      author: nullable(row.author),
      email: nullable(row.email),
      link: nullable(row.link),
      lastupdated: normalizeTimestamp(row.lastupdated),
      is_default: Boolean(row.is_default),
      sort_order: row.sort_order,
    });
  }

  const shows = new Map();
  for (const row of showRows) {
    const playlist = playlistIds.get(row.playlist_id);
    if (!playlist || typeof row.identifier !== 'string' || row.identifier === '') {
      throw new Error('Snapshot show is missing its logical playlist or Internet Archive identifier');
    }
    const key = `${playlist}\0${row.identifier}`;
    if (shows.has(key)) throw new Error(`Snapshot contains duplicate show identity: ${playlist} / ${row.identifier}`);
    shows.set(key, {
      playlist,
      identifier: row.identifier,
      category: nullable(row.category),
      status: nullable(row.status),
      title: nullable(row.title),
      description: nullable(row.description),
      start_year: nullable(row.start_year),
      end_year: nullable(row.end_year),
      imdb: nullable(row.imdb),
      group_name: nullable(row.group_name),
      sort_order: row.sort_order,
    });
  }

  const thumbnails = new Map(thumbnailFiles.map((entry) => [path.posix.basename(entry.path), entry.sha256]));
  return {
    name: reader.name,
    inputPath: reader.inputPath,
    capturedAt: manifest.production_snapshot_at,
    counts: manifest.counts,
    playlists,
    shows,
    thumbnails,
  };
}

export function resolveLocalDataPath(toolingRoot, config) {
  const configured = config?.repos?.data;
  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new Error('config.repos.data must define the local freetv-data repository path');
  }
  return path.resolve(toolingRoot, configured);
}

function readLocalJson(filePath, label) {
  requireFile(filePath, label);
  return parseJson(fs.readFileSync(filePath), label);
}

export function loadLocalDataset(dataRoot) {
  const root = path.resolve(dataRoot);
  requireDirectory(root, 'Local freetv-data repository');
  const playlistRoot = path.join(root, 'playlists');
  const thumbnailRoot = path.join(root, 'thumbs');
  requireDirectory(playlistRoot, 'Local playlist directory');
  requireDirectory(thumbnailRoot, 'Local thumbnail directory');
  const index = readLocalJson(path.join(playlistRoot, 'index.json'), 'Local playlists/index.json');
  const declaredManifest = readLocalJson(path.join(root, 'manifest.json'), 'Local manifest.json');
  if (!isObject(index) || typeof index.default !== 'string' || !Array.isArray(index.playlists)) {
    throw new Error('Local playlists/index.json is invalid');
  }
  if (!isObject(declaredManifest) || declaredManifest.format_version !== 1
    || !isObject(declaredManifest.counts)) {
    throw new Error('Local manifest.json is invalid or unsupported');
  }

  const playlists = new Map();
  const shows = new Map();
  for (const [playlistOrder, indexEntry] of index.playlists.entries()) {
    if (!isObject(indexEntry) || typeof indexEntry.filename !== 'string'
      || !/^[A-Za-z0-9_-]+\.json$/u.test(indexEntry.filename)) {
      throw new Error('Local playlist index contains an invalid filename');
    }
    const filename = indexEntry.filename;
    if (playlists.has(filename)) throw new Error(`Local playlist index contains a duplicate: ${filename}`);
    const playlist = readLocalJson(path.join(playlistRoot, filename), `Local playlist ${filename}`);
    if (!isObject(playlist) || !Array.isArray(playlist.shows)) {
      throw new Error(`Local playlist ${filename} must contain a shows array`);
    }
    if (playlist.filename !== undefined && playlist.filename !== filename) {
      throw new Error(`Local playlist ${filename} declares a different filename`);
    }
    playlists.set(filename, {
      dbtitle: nullable(playlist.dbtitle),
      dbversion: nullable(playlist.dbversion),
      author: nullable(playlist.author),
      email: nullable(playlist.email),
      link: nullable(playlist.link),
      lastupdated: normalizeTimestamp(playlist.lastupdated),
      is_default: index.default === filename,
      sort_order: playlistOrder,
    });

    for (const [showOrder, show] of playlist.shows.entries()) {
      if (!isObject(show) || typeof show.identifier !== 'string' || show.identifier === '') {
        throw new Error(`Local playlist ${filename} contains a show without an identifier`);
      }
      const key = `${filename}\0${show.identifier}`;
      if (shows.has(key)) throw new Error(`Local data contains duplicate show identity: ${filename} / ${show.identifier}`);
      shows.set(key, {
        playlist: filename,
        identifier: show.identifier,
        category: nullable(show.category),
        status: nullable(show.status),
        title: nullable(show.title),
        description: nullable(show.desc),
        start_year: nullable(show.start),
        end_year: nullable(show.end),
        imdb: nullable(show.imdb),
        group_name: nullable(show.group),
        sort_order: showOrder,
      });
    }
  }
  if (!playlists.has(index.default)) throw new Error('Local playlist index default does not name a listed playlist');

  const thumbnails = new Map();
  for (const entry of fs.readdirSync(thumbnailRoot, { withFileTypes: true })) {
    const filePath = path.join(thumbnailRoot, entry.name);
    if (entry.isSymbolicLink() || fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Local thumbnail directory contains a symbolic link: ${entry.name}`);
    }
    if (entry.name === 'index.html' && entry.isFile()) continue;
    if (!entry.isFile() || !THUMBNAIL_NAME_PATTERN.test(entry.name)) {
      throw new Error(`Local thumbnail directory contains an unexpected entry: ${entry.name}`);
    }
    thumbnails.set(entry.name, sha256(fs.readFileSync(filePath)));
  }

  const actualCounts = { playlists: playlists.size, shows: shows.size, thumbnails: thumbnails.size };
  const warnings = [];
  for (const key of Object.keys(actualCounts)) {
    if (declaredManifest.counts[key] !== actualCounts[key]) {
      warnings.push(`manifest counts.${key} declares ${declaredManifest.counts[key]}, actual content has ${actualCounts[key]}`);
    }
  }
  return { root, playlists, shows, thumbnails, actualCounts, declaredManifest, warnings };
}

function compareMaps(production, local, fields, labelForKey) {
  const productionOnly = [];
  const localOnly = [];
  const changed = [];
  const keys = [...new Set([...production.keys(), ...local.keys()])].sort(compareText);
  for (const key of keys) {
    if (!local.has(key)) {
      productionOnly.push(labelForKey(key, production.get(key)));
    } else if (!production.has(key)) {
      localOnly.push(labelForKey(key, local.get(key)));
    } else {
      const differences = [];
      for (const field of fields) {
        const productionValue = production.get(key)[field];
        const localValue = local.get(key)[field];
        if (!Object.is(productionValue, localValue)) {
          differences.push({ field, production: productionValue, local: localValue });
        }
      }
      if (differences.length > 0) {
        changed.push({ ...labelForKey(key, production.get(key)), differences });
      }
    }
  }
  return { productionOnly, localOnly, changed };
}

export function compareContent(production, local) {
  const playlists = compareMaps(
    production.playlists,
    local.playlists,
    PLAYLIST_FIELDS,
    (key) => ({ filename: key }),
  );
  const shows = compareMaps(
    production.shows,
    local.shows,
    SHOW_FIELDS,
    (key, value) => ({ playlist: value.playlist, identifier: value.identifier }),
  );
  const thumbnails = compareMaps(
    production.thumbnails,
    local.thumbnails,
    [],
    (key) => ({ filename: key }),
  );
  for (const key of [...production.thumbnails.keys()]
    .filter((name) => local.thumbnails.has(name)).sort(compareText)) {
    const productionHash = production.thumbnails.get(key);
    const localHash = local.thumbnails.get(key);
    if (productionHash !== localHash) {
      thumbnails.changed.push({
        filename: key,
        differences: [{ field: 'sha256', production: productionHash, local: localHash }],
      });
    }
  }
  return { production, local, playlists, shows, thumbnails };
}

function valueForReport(value) {
  return JSON.stringify(value);
}

function detailLines(title, items, identity) {
  const lines = [];
  for (const item of items) {
    lines.push(`${title}`);
    lines.push(`  ${identity(item)}`);
    for (const difference of item.differences ?? []) {
      lines.push(`    ${difference.field}:`);
      lines.push(`      production: ${valueForReport(difference.production)}`);
      lines.push(`      local:      ${valueForReport(difference.local)}`);
    }
    lines.push('');
  }
  return lines;
}

export function formatComparisonReport(comparison) {
  const { production, local, playlists, shows, thumbnails } = comparison;
  const lines = [
    'FreeTV Content Comparison',
    '',
    'Production snapshot:',
    `  ${production.name}`,
    `  captured: ${production.capturedAt}`,
    '',
    'Local canonical data:',
    `  ${local.root}`,
  ];
  if (local.warnings.length > 0) {
    lines.push('  metadata warnings:');
    for (const warning of local.warnings) lines.push(`    - ${warning}`);
  }
  lines.push(
    '',
    'Summary',
    '  Playlists',
    `    Production only: ${playlists.productionOnly.length}`,
    `    Local only:      ${playlists.localOnly.length}`,
    `    Changed:         ${playlists.changed.length}`,
    '',
    '  Shows',
    `    Production only: ${shows.productionOnly.length}`,
    `    Local only:      ${shows.localOnly.length}`,
    `    Changed:         ${shows.changed.length}`,
    '',
    '  Thumbnails',
    `    Production only: ${thumbnails.productionOnly.length}`,
    `    Local only:      ${thumbnails.localOnly.length}`,
    `    Changed:         ${thumbnails.changed.length}`,
    '',
    'Details',
    '',
  );
  lines.push(...detailLines('PLAYLIST PRODUCTION ONLY', playlists.productionOnly, (item) => item.filename));
  lines.push(...detailLines('PLAYLIST LOCAL ONLY', playlists.localOnly, (item) => item.filename));
  lines.push(...detailLines('PLAYLIST CHANGED', playlists.changed, (item) => item.filename));
  lines.push(...detailLines('SHOW PRODUCTION ONLY', shows.productionOnly,
    (item) => `${item.playlist} / ${item.identifier}`));
  lines.push(...detailLines('SHOW LOCAL ONLY', shows.localOnly,
    (item) => `${item.playlist} / ${item.identifier}`));
  lines.push(...detailLines('SHOW CHANGED', shows.changed,
    (item) => `${item.playlist} / ${item.identifier}`));
  lines.push(...detailLines('THUMBNAIL PRODUCTION ONLY', thumbnails.productionOnly, (item) => item.filename));
  lines.push(...detailLines('THUMBNAIL LOCAL ONLY', thumbnails.localOnly, (item) => item.filename));
  lines.push(...detailLines('THUMBNAIL CHANGED', thumbnails.changed, (item) => item.filename));

  const differenceCount = ['playlists', 'shows', 'thumbnails']
    .flatMap((kind) => ['productionOnly', 'localOnly', 'changed']
      .map((category) => comparison[kind][category].length))
    .reduce((sum, count) => sum + count, 0);
  if (differenceCount === 0) lines.push('No content differences found.');
  return `${lines.join('\n').trimEnd()}\n`;
}

export function runContentComparison({ snapshotPath, dataRoot }) {
  const production = loadProductionSnapshot(snapshotPath);
  const local = loadLocalDataset(dataRoot);
  return compareContent(production, local);
}
