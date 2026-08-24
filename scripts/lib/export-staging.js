import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertNoSymlinkAncestors(candidate, boundary) {
  if (candidate === boundary) return;

  let current = path.dirname(candidate);
  while (isWithin(current, boundary, true)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to reset staging through symbolic-link directory: ${current}`);
    }
    if (current === boundary) break;
    current = path.dirname(current);
  }
}

export function resolveStagingPaths(toolingRoot, config) {
  if (!isObject(config.staging)) {
    throw new Error('config.staging must be an object');
  }

  const ownedRoot = path.join(toolingRoot, 'staging');
  const configuredRoot = config.staging.root;
  if (typeof configuredRoot !== 'string' || configuredRoot.trim() === '') {
    throw new Error('config.staging.root must be a non-empty path');
  }

  const stagingRoot = path.resolve(toolingRoot, configuredRoot);
  if (!isWithin(stagingRoot, ownedRoot, true)) {
    throw new Error(`Configured staging root must be within Tooling-owned root: ${ownedRoot}`);
  }

  const resolveChild = (key) => {
    const configured = config.staging[key];
    if (typeof configured !== 'string' || configured.trim() === '') {
      throw new Error(`config.staging.${key} must be a non-empty path`);
    }
    const resolved = path.resolve(stagingRoot, configured);
    if (!isWithin(resolved, stagingRoot)) {
      throw new Error(`config.staging.${key} must resolve inside the staging root`);
    }
    return resolved;
  };

  const dataRoot = resolveChild('data');
  const thumbnailRoot = resolveChild('thumbnails');
  if (isWithin(dataRoot, thumbnailRoot, true) || isWithin(thumbnailRoot, dataRoot, true)) {
    throw new Error('Data and Thumbnail staging paths must not overlap');
  }

  return {
    ownedRoot,
    stagingRoot,
    dataRoot,
    thumbnailRoot,
  };
}

export function resetStaging(stagingRoot, ownedRoot) {
  const resolvedStaging = path.resolve(stagingRoot);
  const resolvedOwned = path.resolve(ownedRoot);
  if (!isWithin(resolvedStaging, resolvedOwned, true)) {
    throw new Error(`Refusing to reset path outside Tooling-owned staging root: ${resolvedStaging}`);
  }
  assertNoSymlinkAncestors(resolvedStaging, resolvedOwned);
  fs.rmSync(resolvedStaging, { recursive: true, force: true });
}

function readManifest(root, kind) {
  const manifestPath = path.join(root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`${kind} manifest is missing or invalid JSON: ${error.message}`);
  }
  if (!isObject(manifest)) {
    throw new Error(`${kind} manifest must be a JSON object`);
  }
  if (manifest.contract_version !== 1) {
    throw new Error(`${kind} manifest contract_version must equal 1`);
  }
  if (!isObject(manifest.dataset)) {
    throw new Error(`${kind} manifest dataset must be an object`);
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error(`${kind} manifest files must be an array`);
  }
  return manifest;
}

function validateFiles(root, files, kind) {
  const seen = new Set();
  let totalBytes = 0;

  for (const [index, entry] of files.entries()) {
    const label = `${kind} manifest files[${index}]`;
    if (!isObject(entry)) throw new Error(`${label} must be an object`);
    if (typeof entry.path !== 'string' || entry.path === '' || entry.path.includes('\0')) {
      throw new Error(`${label}.path must be a non-empty string`);
    }
    if (entry.path.includes('\\') || path.posix.isAbsolute(entry.path)
      || path.win32.isAbsolute(entry.path) || entry.path.split('/').includes('..')) {
      throw new Error(`${label}.path is unsafe: ${entry.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
    requireNonNegativeInteger(entry.bytes, `${label}.bytes`);
    if (seen.has(entry.path)) throw new Error(`${kind} manifest contains duplicate path: ${entry.path}`);
    seen.add(entry.path);

    const filePath = path.resolve(root, entry.path);
    if (!isWithin(filePath, root)) throw new Error(`${label}.path escapes its staging directory`);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`${kind} manifest referenced file is missing: ${entry.path}`);
    }
    const realFile = fs.realpathSync(filePath);
    const realRoot = fs.realpathSync(root);
    if (!isWithin(realFile, realRoot)) {
      throw new Error(`${kind} manifest referenced file escapes staging through a symbolic link: ${entry.path}`);
    }

    const bytes = fs.statSync(filePath).size;
    if (bytes !== entry.bytes) {
      throw new Error(`${kind} manifest byte size mismatch for ${entry.path}: expected ${entry.bytes}, got ${bytes}`);
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    if (sha256 !== entry.sha256) {
      throw new Error(`${kind} manifest SHA-256 mismatch for ${entry.path}`);
    }
    totalBytes += bytes;
  }

  return { paths: seen, totalBytes };
}

export function validateDataManifest(root) {
  const manifest = readManifest(root, 'Data');
  requireNonNegativeInteger(manifest.dataset.playlist_count, 'Data manifest dataset.playlist_count');
  requireNonNegativeInteger(manifest.dataset.show_count, 'Data manifest dataset.show_count');
  const validated = validateFiles(root, manifest.files, 'Data');

  for (const required of ['config.json', 'playlists/index.json']) {
    if (!validated.paths.has(required)) {
      throw new Error(`Data manifest must represent required file: ${required}`);
    }
  }
  const playlistCount = [...validated.paths]
    .filter((file) => /^playlists\/[^/]+\.json$/.test(file) && file !== 'playlists/index.json').length;
  if (playlistCount !== manifest.dataset.playlist_count) {
    throw new Error(`Data manifest playlist_count mismatch: expected ${manifest.dataset.playlist_count}, represented ${playlistCount}`);
  }
  return manifest;
}

export function validateThumbnailManifest(root) {
  const manifest = readManifest(root, 'Thumbnail');
  requireNonNegativeInteger(manifest.dataset.thumbnail_count, 'Thumbnail manifest dataset.thumbnail_count');
  requireNonNegativeInteger(manifest.dataset.total_bytes, 'Thumbnail manifest dataset.total_bytes');
  const validated = validateFiles(root, manifest.files, 'Thumbnail');
  if (manifest.files.length !== manifest.dataset.thumbnail_count) {
    throw new Error(`Thumbnail manifest thumbnail_count mismatch: expected ${manifest.dataset.thumbnail_count}, represented ${manifest.files.length}`);
  }
  if (validated.totalBytes !== manifest.dataset.total_bytes) {
    throw new Error(`Thumbnail manifest total_bytes mismatch: expected ${manifest.dataset.total_bytes}, represented ${validated.totalBytes}`);
  }
  return manifest;
}

export function runCommand({ executable, args, cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: 'inherit' });
    child.once('error', (error) => {
      if (error.code === 'ENOENT' && executable === 'php') {
        reject(new Error(`${label} requires PHP CLI, but 'php' was not found on PATH`));
      } else {
        reject(new Error(`${label} could not start: ${error.message}`));
      }
    });
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
  });
}

export async function stageServerExports({ toolingRoot, config, commandRunner = runCommand }) {
  const serverRoot = path.resolve(toolingRoot, config.repos?.server ?? '');
  const paths = resolveStagingPaths(toolingRoot, config);

  resetStaging(paths.stagingRoot, paths.ownedRoot);
  fs.mkdirSync(paths.stagingRoot, { recursive: true });
  fs.mkdirSync(path.dirname(paths.dataRoot), { recursive: true });
  fs.mkdirSync(path.dirname(paths.thumbnailRoot), { recursive: true });

  try {
    await commandRunner({
      executable: 'php',
      args: ['tools/export-viewer-data.php', paths.dataRoot],
      cwd: serverRoot,
      label: 'Server Data exporter',
    });
    const dataManifest = validateDataManifest(paths.dataRoot);

    await commandRunner({
      executable: 'php',
      args: ['tools/export-thumbnails.php', paths.thumbnailRoot],
      cwd: serverRoot,
      label: 'Server Thumbnail exporter',
    });
    const thumbnailManifest = validateThumbnailManifest(paths.thumbnailRoot);

    console.log('Server export staging complete:');
    console.log(`  Data: ${dataManifest.dataset.playlist_count} playlists, ${dataManifest.dataset.show_count} shows`);
    console.log(`  Thumbnails: ${thumbnailManifest.dataset.thumbnail_count} files, ${thumbnailManifest.dataset.total_bytes} bytes`);
    if (dataManifest.server_revision !== thumbnailManifest.server_revision) {
      console.warn('  Warning: Data and Thumbnail server revisions differ.');
    }
    return { dataManifest, thumbnailManifest, paths };
  } catch (error) {
    resetStaging(paths.stagingRoot, paths.ownedRoot);
    throw error;
  }
}
