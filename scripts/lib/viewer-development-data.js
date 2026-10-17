import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'fs-extra';

const MANAGED_ARTIFACTS = Object.freeze([
  { name: 'config.json', type: 'file' },
  { name: 'playlists', type: 'directory' },
  { name: 'thumbs', type: 'directory' },
]);
const OWNERSHIP_MARKER = '.freetv-tooling-development-data.json';
const TRANSACTION_PREFIX = '.freetv-tooling-development-data-';
const OWNERSHIP_CONTRACT = 'freetv-tooling-viewer-development-data-v1';

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function pathsOverlap(left, right) {
  return left === right || isWithin(left, right) || isWithin(right, left);
}

function configuredRepository(toolingRoot, config, name) {
  const configured = config?.repos?.[name];
  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new Error(`config.repos.${name} must be a non-empty path`);
  }
  return path.resolve(toolingRoot, configured);
}

function entryExists(target, fileSystem = fs) {
  try {
    fileSystem.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function requirePath(target, type, label, fileSystem = fs) {
  if (!entryExists(target, fileSystem)) throw new Error(`${label} is missing: ${target}`);
  const stats = fileSystem.lstatSync(target);
  if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${target}`);
  if ((type === 'file' && !stats.isFile()) || (type === 'directory' && !stats.isDirectory())) {
    throw new Error(`${label} must be a ${type}: ${target}`);
  }
}

function assertSafeViewerRoot(toolingRoot, viewerRoot) {
  if (viewerRoot === path.parse(viewerRoot).root) {
    throw new Error('config.repos.viewer must not resolve to the filesystem root');
  }
  if (viewerRoot === toolingRoot) {
    throw new Error('config.repos.viewer must not resolve to the Tooling root');
  }
  requirePath(viewerRoot, 'directory', 'FreeTV Viewer repository');
}

function resolveViewerPaths(toolingRoot, config) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const viewerRoot = configuredRepository(resolvedToolingRoot, config, 'viewer');
  assertSafeViewerRoot(resolvedToolingRoot, viewerRoot);

  const publicRoot = path.resolve(viewerRoot, 'public');
  requirePath(publicRoot, 'directory', 'FreeTV Viewer public directory');

  const realViewerRoot = fs.realpathSync(viewerRoot);
  const realPublicRoot = fs.realpathSync(publicRoot);
  if (!isWithin(realPublicRoot, realViewerRoot)) {
    throw new Error('FreeTV Viewer public directory resolves outside the Viewer repository');
  }

  const destinations = Object.fromEntries(MANAGED_ARTIFACTS.map(({ name }) => {
    const destination = path.resolve(publicRoot, name);
    if (path.dirname(destination) !== publicRoot || !isWithin(destination, publicRoot)) {
      throw new Error(`Unsafe Viewer development-data destination: ${destination}`);
    }
    return [name, destination];
  }));

  return { publicRoot, viewerRoot, destinations };
}

export function loadViewerDevelopmentDataConfig(toolingRoot) {
  const configPath = path.join(path.resolve(toolingRoot), 'config/paths.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read Tooling paths configuration at ${configPath}: ${error.message}`);
  }
}

export function resolveViewerDevelopmentDataPaths(toolingRoot, config) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const viewer = resolveViewerPaths(resolvedToolingRoot, config);
  const dataRoot = configuredRepository(resolvedToolingRoot, config, 'data');

  if (dataRoot === path.parse(dataRoot).root || dataRoot === resolvedToolingRoot) {
    throw new Error('config.repos.data resolves to an unsafe repository path');
  }
  if (pathsOverlap(dataRoot, viewer.publicRoot)) {
    throw new Error('FreeTV Data repository must not overlap the Viewer public directory');
  }

  const sources = Object.fromEntries(MANAGED_ARTIFACTS.map(({ name }) => [
    name,
    path.join(dataRoot, name),
  ]));

  return { ...viewer, dataRoot, sources };
}

function preflightSources(paths) {
  requirePath(paths.dataRoot, 'directory', 'FreeTV Data repository');
  for (const { name, type } of MANAGED_ARTIFACTS) {
    requirePath(paths.sources[name], type, `FreeTV Data ${name}`);
  }
}

function snapshot(target, fileSystem = fs, relative = '') {
  const stats = fileSystem.lstatSync(target);
  if (stats.isSymbolicLink()) throw new Error(`Development-data tree contains a symbolic link: ${target}`);
  if (stats.isFile()) {
    return [[relative, crypto.createHash('sha256').update(fileSystem.readFileSync(target)).digest('hex')]];
  }
  if (!stats.isDirectory()) throw new Error(`Development-data tree contains an unsupported entry: ${target}`);
  return fileSystem.readdirSync(target).sort().flatMap((name) => snapshot(
    path.join(target, name), fileSystem, relative ? `${relative}/${name}` : name,
  ));
}

function markerRecord(paths) {
  return {
    contract: OWNERSHIP_CONTRACT,
    viewerRoot: paths.viewerRoot,
    publicRoot: paths.publicRoot,
    managedArtifacts: MANAGED_ARTIFACTS.map(({ name }) => name),
  };
}

function markerPath(paths) {
  return path.join(paths.publicRoot, OWNERSHIP_MARKER);
}

function readOwnership(paths, fileSystem = fs) {
  const target = markerPath(paths);
  if (!entryExists(target, fileSystem)) return null;
  requirePath(target, 'file', 'Viewer development-data ownership marker', fileSystem);
  let record;
  try { record = JSON.parse(fileSystem.readFileSync(target, 'utf8')); } catch (error) {
    throw new Error(`Viewer development-data ownership marker is invalid: ${target}: ${error.message}`);
  }
  if (JSON.stringify(record) !== JSON.stringify(markerRecord(paths))) {
    throw new Error(`Viewer development-data ownership marker does not match the configured Viewer: ${target}`);
  }
  return record;
}

function assertNoInterruptedTransaction(paths, fileSystem = fs) {
  const stale = fileSystem.readdirSync(paths.publicRoot).find((name) => name.startsWith(TRANSACTION_PREFIX));
  if (stale) throw new Error(`Interrupted Viewer development-data transaction requires manual inspection: ${path.join(paths.publicRoot, stale)}`);
}

function existingManaged(paths, fileSystem = fs) {
  return MANAGED_ARTIFACTS.filter(({ name }) => entryExists(paths.destinations[name], fileSystem));
}

function validateDestinations(paths, fileSystem = fs) {
  for (const { name, type } of existingManaged(paths, fileSystem)) {
    const target = paths.destinations[name];
    const stats = fileSystem.lstatSync(target);
    if (stats.isSymbolicLink() || (type === 'file' ? !stats.isFile() : !stats.isDirectory())) {
      throw new Error(`Viewer development-data destination is unsafe or ambiguous: ${target}`);
    }
  }
}

export function inspectViewerDevelopmentData({ toolingRoot, config, fileSystem = fs } = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const effectiveConfig = config ?? loadViewerDevelopmentDataConfig(resolvedToolingRoot);
  const paths = resolveViewerDevelopmentDataPaths(resolvedToolingRoot, effectiveConfig);

  validateDestinations(paths, fileSystem);
  assertNoInterruptedTransaction(paths, fileSystem);
  const ownership = readOwnership(paths, fileSystem);
  const existing = existingManaged(paths, fileSystem);
  if (!ownership) {
    if (existing.length === 0) return { state: 'absent', paths };
    throw new Error('Existing Viewer development data is unmarked; manual inspection is required before startup');
  }
  if (existing.length !== MANAGED_ARTIFACTS.length) {
    const missing = MANAGED_ARTIFACTS
      .filter(({ name }) => !existing.some((artifact) => artifact.name === name))
      .map(({ name }) => name);
    throw new Error(`Tooling-managed Viewer development data is incomplete; missing ${missing.join(', ')}; manual inspection is required`);
  }
  return { state: 'ready', paths };
}

export async function prepareViewerDevelopmentData({
  toolingRoot,
  config,
  fileSystem = fs,
  inspector = inspectViewerDevelopmentData,
  installer = installViewerDevelopmentData,
  logger = console,
} = {}) {
  const inspection = inspector({ toolingRoot, config, fileSystem });
  if (inspection.state === 'ready') return { installed: false, paths: inspection.paths };
  const paths = await installer({ toolingRoot, config, fileSystem });
  logger.log('Installed missing Viewer development data from the configured freetv-data repository.');
  return { installed: true, paths };
}

export async function installViewerDevelopmentData({
  toolingRoot,
  config,
  runId = crypto.randomBytes(6).toString('hex'),
  fileSystem = fs,
  transactionHooks = {},
} = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const effectiveConfig = config ?? loadViewerDevelopmentDataConfig(resolvedToolingRoot);
  const paths = resolveViewerDevelopmentDataPaths(resolvedToolingRoot, effectiveConfig);

  // Complete every validation before changing disposable Viewer state.
  preflightSources(paths);
  if (pathsOverlap(fileSystem.realpathSync(paths.dataRoot), fileSystem.realpathSync(paths.publicRoot))) {
    throw new Error('FreeTV Data repository must not overlap the Viewer public directory through symbolic links');
  }
  validateDestinations(paths, fileSystem);
  assertNoInterruptedTransaction(paths, fileSystem);
  const ownership = readOwnership(paths, fileSystem);
  if (!ownership && existingManaged(paths, fileSystem).length > 0) {
    throw new Error('Existing Viewer development data is unmarked and will not be replaced automatically; manual inspection is required');
  }

  if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error('Viewer development-data transaction ID is unsafe');
  const transactionRoot = path.join(paths.publicRoot, `${TRANSACTION_PREFIX}${runId}`);
  const preparedRoot = path.join(transactionRoot, 'new');
  const backupRoot = path.join(transactionRoot, 'old');
  if (entryExists(transactionRoot, fileSystem)) throw new Error(`Viewer development-data transaction already exists: ${transactionRoot}`);
  fileSystem.mkdirSync(preparedRoot, { recursive: true });
  fileSystem.mkdirSync(backupRoot);
  try {
    for (const { name } of MANAGED_ARTIFACTS) {
      fileSystem.copySync(paths.sources[name], path.join(preparedRoot, name), { overwrite: false, errorOnExist: true });
      transactionHooks.afterCandidateCopy?.({ name, transactionRoot });
    }
    for (const { name } of MANAGED_ARTIFACTS) {
      if (JSON.stringify(snapshot(paths.sources[name], fileSystem))
        !== JSON.stringify(snapshot(path.join(preparedRoot, name), fileSystem))) {
        throw new Error(`Prepared Viewer development data does not match source: ${name}`);
      }
    }
  } catch (error) {
    try {
      fileSystem.removeSync(transactionRoot);
    } catch (cleanupError) {
      throw new Error(`Could not prepare Viewer development data; previous installation is intact: ${error.message}; transaction cleanup failed and may have partially removed contents at ${transactionRoot}: ${cleanupError.message}`, { cause: error });
    }
    throw new Error(`Could not prepare Viewer development data; previous installation is intact: ${error.message}`, { cause: error });
  }

  const states = MANAGED_ARTIFACTS.map(({ name }) => ({ name, backedUp: false, installed: false }));
  try {
    for (const state of states) {
      const destination = paths.destinations[state.name];
      if (entryExists(destination, fileSystem)) {
        fileSystem.renameSync(destination, path.join(backupRoot, state.name));
        state.backedUp = true;
      }
      transactionHooks.beforePromotion?.({ name: state.name, transactionRoot });
      fileSystem.renameSync(path.join(preparedRoot, state.name), destination);
      state.installed = true;
    }
  } catch (error) {
    const failures = [];
    for (const state of [...states].reverse()) {
      try {
        const destination = paths.destinations[state.name];
        if (state.installed && entryExists(destination, fileSystem)) {
          fileSystem.renameSync(destination, path.join(preparedRoot, state.name));
        }
        if (state.backedUp && entryExists(path.join(backupRoot, state.name), fileSystem)) {
          transactionHooks.beforeRollback?.({ name: state.name, transactionRoot });
          fileSystem.renameSync(path.join(backupRoot, state.name), destination);
        }
      } catch (rollbackError) { failures.push(`${state.name}: ${rollbackError.message}`); }
    }
    if (failures.length > 0) {
      throw new Error(`Viewer development-data promotion failed and rollback was incomplete; recovery state retained at ${transactionRoot}: ${failures.join('; ')}`, { cause: error });
    }
    try {
      fileSystem.removeSync(transactionRoot);
    } catch (cleanupError) {
      throw new Error(`Viewer development-data promotion failed and previous installation was restored: ${error.message}; transaction cleanup failed and may have partially removed contents at ${transactionRoot}: ${cleanupError.message}`, { cause: error });
    }
    throw new Error(`Viewer development-data promotion failed and previous installation was restored: ${error.message}`, { cause: error });
  }

  if (!ownership) {
    try {
      fileSystem.writeFileSync(markerPath(paths), `${JSON.stringify(markerRecord(paths), null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      throw new Error(`Viewer development data was installed, but ownership marker creation failed; recovery state retained at ${transactionRoot}: ${error.message}`, { cause: error });
    }
  }
  try { fileSystem.removeSync(transactionRoot); } catch (error) {
    throw new Error(`Viewer development data was installed, but transaction cleanup failed and may be partial; inspect ${transactionRoot}: ${error.message}`, { cause: error });
  }

  return paths;
}

export async function cleanViewerDevelopmentData({ toolingRoot, config, fileSystem = fs } = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const effectiveConfig = config ?? loadViewerDevelopmentDataConfig(resolvedToolingRoot);
  const paths = resolveViewerPaths(resolvedToolingRoot, effectiveConfig);

  validateDestinations(paths, fileSystem);
  assertNoInterruptedTransaction(paths, fileSystem);
  const ownership = readOwnership(paths, fileSystem);
  const existing = existingManaged(paths, fileSystem);
  if (!ownership) {
    if (existing.length === 0) return paths;
    throw new Error('Existing Viewer development data is unmarked and will not be cleaned automatically; manual inspection is required');
  }
  for (const { name } of MANAGED_ARTIFACTS) fileSystem.removeSync(paths.destinations[name]);
  fileSystem.unlinkSync(markerPath(paths));
  return paths;
}
