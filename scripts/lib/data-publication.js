import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalDataset, loadProductionSnapshot } from './content-comparison.js';
import {
  generateValidatedDatasetArtifacts,
  resolveDatasetValidationPaths,
  runValidationCommand,
  validateDatasetPublication,
} from './data-validation.js';
import { resetStaging } from './export-staging.js';

export const SQL_PACKAGE_FILES = Object.freeze([
  'freetv_mariadb_schema-create-db.sql',
  'freetv_mariadb_schema-tables-only.sql',
  'freetv_mariadb_full-create-db.sql',
  'freetv_mariadb_full_data-tables-only.sql',
  'freetv_mariadb_sample-create-db.sql',
  'freetv_mariadb_sample_data-tables-only.sql',
]);

export const MANAGED_PUBLICATION_PATHS = Object.freeze([
  'config.json',
  'playlists',
  'thumbs',
  ...SQL_PACKAGE_FILES,
  'manifest.json',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return isWithin(left, right, true) || isWithin(right, left, true);
}

function pathEntryExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function requireSafeDirectory(directory, label) {
  if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()
    || !fs.lstatSync(directory).isDirectory()) {
    throw new Error(`${label} is missing or unsafe: ${directory}`);
  }
}

function requireSafeFile(filePath, label) {
  if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()
    || !fs.lstatSync(filePath).isFile()) {
    throw new Error(`${label} is missing or unsafe: ${filePath}`);
  }
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function listCandidateFiles(root) {
  const files = [];
  function walk(directory, relativeRoot = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.join(relativeRoot, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || fs.lstatSync(absolutePath).isSymbolicLink()) {
        throw new Error(`Publication candidate contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) walk(absolutePath, relativePath);
      else if (entry.isFile()) files.push(relativePath.split(path.sep).join('/'));
      else throw new Error(`Publication candidate contains an unsupported entry: ${relativePath}`);
    }
  }
  walk(root);
  return files.sort();
}

function assertCanonicalTimestamp(value, label) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
}

function isSafeRelativePath(value) {
  return typeof value === 'string' && value !== '' && !value.includes('\\')
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.split('/').includes('..');
}

function validateCopiedManifestFiles(candidateRoot, manifest, label) {
  for (const entry of manifest.files) {
    if (!isObject(entry) || !isSafeRelativePath(entry.path)) {
      throw new Error(`${label} contains an unsafe candidate path`);
    }
    const filePath = path.resolve(candidateRoot, entry.path);
    if (!isWithin(filePath, candidateRoot)) throw new Error(`${label} path escapes publication candidate`);
    requireSafeFile(filePath, `${label} ${entry.path}`);
    const contents = fs.readFileSync(filePath);
    if (contents.length !== entry.bytes || sha256(contents) !== entry.sha256) {
      throw new Error(`${label} changed while assembling candidate: ${entry.path}`);
    }
  }
}

function copyFile(source, destination) {
  requireSafeFile(source, 'Publication source file');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode);
}

function exactManifest({ generatedAt, snapshot, artifacts }) {
  return {
    format_version: 1,
    generated_at: generatedAt,
    reconciled_snapshot: {
      name: snapshot.name,
      captured_at: snapshot.capturedAt,
    },
    counts: {
      playlists: artifacts.dataManifest.dataset.playlist_count,
      shows: artifacts.dataManifest.dataset.show_count,
      sample_shows: artifacts.sqlSummary.sample_count,
      thumbnails: artifacts.thumbnailManifest.dataset.thumbnail_count,
    },
  };
}

export function validatePublicationCandidate(candidateRoot, context) {
  requireSafeDirectory(candidateRoot, 'Publication candidate');
  requireSafeDirectory(path.join(candidateRoot, 'playlists'), 'Publication playlist directory');
  requireSafeDirectory(path.join(candidateRoot, 'thumbs'), 'Publication thumbnail directory');
  const manifestPath = path.join(candidateRoot, 'manifest.json');
  requireSafeFile(manifestPath, 'Publication manifest');
  let manifest;
  let config;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    config = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'config.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Publication candidate JSON is invalid: ${error.message}`);
  }
  if (!isObject(config)) throw new Error('Publication candidate config.json must be an object');

  const expectedManifest = exactManifest(context);
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) {
    throw new Error('Publication manifest does not match generated artifacts and snapshot provenance');
  }
  assertCanonicalTimestamp(manifest.generated_at, 'Publication manifest generated_at');
  assertCanonicalTimestamp(manifest.reconciled_snapshot.captured_at, 'Publication snapshot captured_at');

  const expectedFiles = [
    ...context.artifacts.dataManifest.files.map((entry) => entry.path),
    ...context.artifacts.thumbnailManifest.files.map((entry) => entry.path),
    ...SQL_PACKAGE_FILES,
    'manifest.json',
  ].sort();
  if (new Set(expectedFiles).size !== expectedFiles.length
    || listCandidateFiles(candidateRoot).join('\n') !== expectedFiles.join('\n')) {
    throw new Error('Publication candidate contains missing, duplicate, or unexpected files');
  }
  validateCopiedManifestFiles(candidateRoot, context.artifacts.dataManifest, 'Viewer export');
  validateCopiedManifestFiles(candidateRoot, context.artifacts.thumbnailManifest, 'Thumbnail export');
  if (context.sqlFiles.map((entry) => entry.path).join('\n') !== SQL_PACKAGE_FILES.join('\n')) {
    throw new Error('Publication candidate SQL package contract is incomplete');
  }
  for (const entry of context.sqlFiles) {
    const sqlPath = path.join(candidateRoot, entry.path);
    requireSafeFile(sqlPath, `SQL package ${entry.path}`);
    const contents = fs.readFileSync(sqlPath);
    if (contents.length === 0 || contents.length !== entry.bytes || sha256(contents) !== entry.sha256) {
      throw new Error(`SQL package changed after restore validation: ${entry.path}`);
    }
  }

  const local = loadLocalDataset(candidateRoot);
  const expectedCounts = expectedManifest.counts;
  if (local.actualCounts.playlists !== expectedCounts.playlists
    || local.actualCounts.shows !== expectedCounts.shows
    || local.actualCounts.thumbnails !== expectedCounts.thumbnails
    || local.warnings.length > 0) {
    throw new Error('Publication candidate logical counts do not match its manifest');
  }
  return manifest;
}

export function createPublicationCandidate({ paths, artifacts, snapshot, generatedAt }) {
  assertCanonicalTimestamp(generatedAt, 'Publication generated_at');
  const candidateRoot = path.join(paths.validationRoot, 'candidate');
  fs.mkdirSync(candidateRoot);
  fs.mkdirSync(path.join(candidateRoot, 'playlists'));
  fs.mkdirSync(path.join(candidateRoot, 'thumbs'));

  for (const entry of artifacts.dataManifest.files) {
    if (!isObject(entry) || !isSafeRelativePath(entry.path)
      || (entry.path !== 'config.json' && !entry.path.startsWith('playlists/'))) {
      throw new Error(`Viewer export contains an unsafe or unmanaged publication path: ${entry?.path}`);
    }
    copyFile(path.join(artifacts.paths.dataRoot, entry.path), path.join(candidateRoot, entry.path));
  }
  for (const entry of artifacts.thumbnailManifest.files) {
    if (!isObject(entry) || !isSafeRelativePath(entry.path) || !entry.path.startsWith('thumbs/')) {
      throw new Error(`Thumbnail export contains an unsafe or unmanaged publication path: ${entry?.path}`);
    }
    copyFile(path.join(artifacts.paths.thumbnailRoot, entry.path), path.join(candidateRoot, entry.path));
  }
  const sqlFiles = SQL_PACKAGE_FILES.map((filename) => {
    const source = path.join(paths.sqlRoot, filename);
    requireSafeFile(source, `SQL package ${filename}`);
    const contents = fs.readFileSync(source);
    if (contents.length === 0) throw new Error(`SQL package is empty: ${filename}`);
    copyFile(source, path.join(candidateRoot, filename));
    return { path: filename, bytes: contents.length, sha256: sha256(contents) };
  });

  const manifest = exactManifest({ generatedAt, snapshot, artifacts });
  fs.writeFileSync(path.join(candidateRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  const context = { generatedAt, snapshot, artifacts, sqlFiles };
  validatePublicationCandidate(candidateRoot, context);
  return { candidateRoot, context, manifest };
}

function assertSafePromotionPaths(candidateRoot, dataRoot, runId) {
  if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error('Publication transaction ID is unsafe');
  requireSafeDirectory(candidateRoot, 'Publication candidate');
  requireSafeDirectory(dataRoot, 'FreeTV Data repository');
  const resolvedDataRoot = path.resolve(dataRoot);
  if (resolvedDataRoot === path.parse(resolvedDataRoot).root || pathsOverlap(candidateRoot, resolvedDataRoot)) {
    throw new Error('Publication candidate and FreeTV Data paths are unsafe or overlapping');
  }
  for (const name of MANAGED_PUBLICATION_PATHS) {
    const target = path.resolve(resolvedDataRoot, name);
    if (path.dirname(target) !== resolvedDataRoot || !isWithin(target, resolvedDataRoot)) {
      throw new Error(`Managed publication path is unsafe: ${name}`);
    }
    if (pathEntryExists(target) && fs.lstatSync(target).isSymbolicLink()) {
      throw new Error(`Managed publication target must not be a symbolic link: ${target}`);
    }
  }
  const staleTransaction = fs.readdirSync(resolvedDataRoot)
    .find((name) => name.startsWith('.freetv-publication-'));
  if (staleTransaction) {
    throw new Error(`Unresolved publication transaction requires inspection: ${path.join(resolvedDataRoot, staleTransaction)}`);
  }
  const transactionRoot = path.join(resolvedDataRoot, `.freetv-publication-${runId}`);
  if (pathEntryExists(transactionRoot)) throw new Error(`Publication transaction path already exists: ${transactionRoot}`);
  return { resolvedDataRoot, transactionRoot };
}

export function promotePublicationCandidate({ candidateRoot, dataRoot, runId, context, fileSystem = fs }) {
  validatePublicationCandidate(candidateRoot, context);
  const { resolvedDataRoot, transactionRoot } = assertSafePromotionPaths(candidateRoot, dataRoot, runId);
  const preparedRoot = path.join(transactionRoot, 'new');
  const backupRoot = path.join(transactionRoot, 'old');
  fileSystem.mkdirSync(preparedRoot, { recursive: true });
  fileSystem.mkdirSync(backupRoot);

  try {
    for (const name of MANAGED_PUBLICATION_PATHS) {
      fileSystem.cpSync(path.join(candidateRoot, name), path.join(preparedRoot, name), {
        recursive: true,
        errorOnExist: true,
      });
    }
    validatePublicationCandidate(preparedRoot, context);
  } catch (error) {
    fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
    throw new Error(`Could not prepare publication transaction: ${error.message}`, { cause: error });
  }

  const states = MANAGED_PUBLICATION_PATHS.map((name) => ({ name, backedUp: false, installed: false }));
  try {
    for (const state of states) {
      const target = path.join(resolvedDataRoot, state.name);
      const backup = path.join(backupRoot, state.name);
      const prepared = path.join(preparedRoot, state.name);
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
      const target = path.join(resolvedDataRoot, state.name);
      const backup = path.join(backupRoot, state.name);
      const prepared = path.join(preparedRoot, state.name);
      try {
        if (state.installed && fileSystem.existsSync(target)) fileSystem.renameSync(target, prepared);
        if (state.backedUp && fileSystem.existsSync(backup)) fileSystem.renameSync(backup, target);
      } catch (rollbackError) {
        rollbackFailures.push(`${state.name}: ${rollbackError.message}`);
      }
    }
    if (rollbackFailures.length === 0) {
      fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
      throw new Error(`Publication promotion failed and was rolled back: ${error.message}`, { cause: error });
    }
    throw new Error(
      `Publication promotion failed and rollback was incomplete; recovery state retained at ${transactionRoot}: ${rollbackFailures.join('; ')}`,
      { cause: error },
    );
  }

  try {
    fileSystem.rmSync(transactionRoot, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Dataset was promoted, but publication transaction cleanup failed; inspect ${transactionRoot}: ${error.message}`,
      { cause: error },
    );
  }
}

function quietLogger(logger) {
  return { log() {}, warn: (...args) => logger.warn?.(...args), error: (...args) => logger.error?.(...args) };
}

export async function publishDataset({
  toolingRoot,
  config,
  snapshotPath,
  commandRunner = runValidationCommand,
  validationGate = validateDatasetPublication,
  artifactGenerator = generateValidatedDatasetArtifacts,
  snapshotLoader = loadProductionSnapshot,
  promoter = promotePublicationCandidate,
  logger = console,
  runId = crypto.randomBytes(6).toString('hex'),
  clock = () => new Date(),
} = {}) {
  const snapshot = snapshotLoader(snapshotPath);
  const paths = resolveDatasetValidationPaths(toolingRoot, config, runId);
  if (pathsOverlap(snapshot.inputPath, paths.dataRoot)) {
    throw new Error('Reconciliation snapshot must not be stored inside freetv-data');
  }

  try {
    await validationGate({ toolingRoot, config, commandRunner, logger: quietLogger(logger) });
  } catch (error) {
    throw new Error(`Mandatory validation gate returned NO GO: ${error.message}`, { cause: error });
  }
  logger.log('Mandatory publication validation gate: GO');

  let result;
  let failure;
  let promoted = false;
  try {
    const artifacts = await artifactGenerator({ paths, commandRunner, logger });
    const generatedAt = clock().toISOString();
    const candidate = createPublicationCandidate({ paths, artifacts, snapshot, generatedAt });
    promoter({
      candidateRoot: candidate.candidateRoot,
      dataRoot: paths.dataRoot,
      runId,
      context: candidate.context,
    });
    promoted = true;
    result = {
      dataRoot: paths.dataRoot,
      manifest: candidate.manifest,
      thumbnailBytes: artifacts.thumbnailManifest.dataset.total_bytes,
    };
  } catch (error) {
    failure = error;
  }

  try {
    resetStaging(paths.validationRoot, paths.stagingOwnedRoot);
  } catch (error) {
    failure = new Error(
      failure
        ? `${failure.message}; publication staging cleanup also failed: ${error.message}`
        : `${promoted ? 'Dataset was published locally, but ' : ''}publication staging cleanup failed: ${error.message}`,
      { cause: error },
    );
  }
  if (failure) throw failure;
  return result;
}
