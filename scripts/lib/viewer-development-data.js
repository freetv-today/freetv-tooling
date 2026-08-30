import path from 'node:path';
import fs from 'fs-extra';

const MANAGED_ARTIFACTS = Object.freeze([
  { name: 'config.json', type: 'file' },
  { name: 'playlists', type: 'directory' },
  { name: 'thumbs', type: 'directory' },
]);

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

function requirePath(target, type, label) {
  if (!fs.existsSync(target)) throw new Error(`${label} is missing: ${target}`);
  const stats = fs.lstatSync(target);
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

export async function installViewerDevelopmentData({ toolingRoot, config } = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const effectiveConfig = config ?? loadViewerDevelopmentDataConfig(resolvedToolingRoot);
  const paths = resolveViewerDevelopmentDataPaths(resolvedToolingRoot, effectiveConfig);

  // Complete every validation before changing disposable Viewer state.
  preflightSources(paths);

  for (const { name } of MANAGED_ARTIFACTS) await fs.remove(paths.destinations[name]);
  for (const { name } of MANAGED_ARTIFACTS) {
    await fs.copy(paths.sources[name], paths.destinations[name], { overwrite: true });
  }

  return paths;
}

export async function cleanViewerDevelopmentData({ toolingRoot, config } = {}) {
  const resolvedToolingRoot = path.resolve(toolingRoot);
  const effectiveConfig = config ?? loadViewerDevelopmentDataConfig(resolvedToolingRoot);
  const paths = resolveViewerPaths(resolvedToolingRoot, effectiveConfig);

  for (const { name } of MANAGED_ARTIFACTS) await fs.remove(paths.destinations[name]);
  return paths;
}
