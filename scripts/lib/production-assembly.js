import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateDataManifest, validateThumbnailManifest } from './export-staging.js';

const VIEWER_ROOT_ENTRIES = new Set([
  '.htaccess',
  'assets',
  'index.html',
  'manifest.json',
  'service-worker.js',
]);
const ADMIN_ROOT_ENTRIES = new Set(['assets', 'index.html']);
const PRODUCTION_ROOT_ENTRIES = new Set(['composer.json', 'composer.lock', 'public', 'temp', 'vendor']);
const PUBLIC_ROOT_ENTRIES = new Set([
  '.htaccess',
  'admin',
  'api',
  'assets',
  'config.json',
  'index.html',
  'manifest.json',
  'playlists',
  'service-worker.js',
  'thumbs',
]);
const TEMP_ROOT_ENTRIES = new Set(['publication-undo', 'thumbnail-undo']);
const FRONTEND_ASSET_EXTENSIONS = new Set([
  '.css', '.gif', '.html', '.jpg', '.js', '.nfo', '.png', '.svg', '.ttf',
]);
const API_ALLOWED_EXTENSIONS = new Set(['.html', '.php']);
const API_ALLOWED_DIRECTORIES = new Set(['admin', 'admin/publication']);
const API_EXCLUDED_DIRECTORIES = new Set(['backup', 'backups', 'temp', 'tests', 'test', 'tmp']);
const API_EXCLUDED_EXTENSIONS = new Set([
  '.bak', '.backup', '.crt', '.dump', '.key', '.old', '.orig', '.p12', '.pem', '.pfx', '.sql', '.swp', '.tmp',
]);
const VENDOR_EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'test', 'tests', 'tools']);
const VIEWER_MANIFEST_IDENTITY = Object.freeze({
  id: '/', name: 'FreeTV Viewer', short_name: 'FreeTV', lang: 'en-US', start_url: '/', scope: '/', display: 'standalone',
});
const VIEWER_MANIFEST_ICONS = new Map([
  ['/assets/app-icons/freetv-192x192.png', { width: 192, height: 192, purpose: undefined }],
  ['/assets/app-icons/freetv-512x512.png', { width: 512, height: 512, purpose: 'any' }],
  ['/assets/app-icons/freetv-512x512-maskable.png', { width: 512, height: 512, purpose: 'maskable' }],
]);
export const VIEWER_SPA_HTACCESS = `RewriteEngine On
RewriteBase /

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
`;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWithin(candidate, parent, allowEqual = false) {
  const relative = path.relative(parent, candidate);
  return (allowEqual && relative === '')
    || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requirePath(target, type, label) {
  if (!fs.existsSync(target)) throw new Error(`${label} is missing: ${target}`);
  const stats = fs.statSync(target);
  if ((type === 'file' && !stats.isFile()) || (type === 'directory' && !stats.isDirectory())) {
    throw new Error(`${label} must be a ${type}: ${target}`);
  }
}

function walk(root, relativeRoot = '') {
  const entries = [];
  for (const entry of fs.readdirSync(path.join(root, relativeRoot), { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name);
    entries.push({ entry, relativePath, absolutePath: path.join(root, relativePath) });
    if (entry.isDirectory()) entries.push(...walk(root, relativePath));
  }
  return entries;
}

function assertNoSymlinks(root, label) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${root}`);
  for (const { entry, relativePath } of walk(root)) {
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${relativePath}`);
  }
}

function assertExactEntries(root, expected, label) {
  const actual = new Set(fs.readdirSync(root));
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const unexpected = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length > 0) throw new Error(`${label} is missing required root entries: ${missing.join(', ')}`);
  if (unexpected.length > 0) throw new Error(`${label} contains unexpected root entries: ${unexpected.join(', ')}`);
}

function validateFrontendAssets(root, label) {
  const assetsRoot = path.join(root, 'assets');
  requirePath(assetsRoot, 'directory', `${label} assets`);
  let hasJavaScript = false;
  let hasCss = false;
  for (const { entry, relativePath } of walk(assetsRoot)) {
    if (!entry.isFile()) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (!FRONTEND_ASSET_EXTENSIONS.has(extension)) {
      throw new Error(`${label} contains unsupported frontend asset: assets/${relativePath}`);
    }
    if (extension === '.js') hasJavaScript = true;
    if (extension === '.css') hasCss = true;
  }
  if (!hasJavaScript || !hasCss) throw new Error(`${label} must contain JavaScript and CSS bundles under assets/`);
}

function readPngDimensions(filePath) {
  const data = fs.readFileSync(filePath);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature)
    || data.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function validateViewerManifest(viewerDist) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(viewerDist, 'manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`Viewer manifest.json is invalid JSON: ${error.message}`);
  }
  for (const [field, expected] of Object.entries(VIEWER_MANIFEST_IDENTITY)) {
    if (manifest[field] !== expected) throw new Error(`Viewer manifest.json ${field} must be ${JSON.stringify(expected)}`);
  }
  if (!Array.isArray(manifest.display_override) || manifest.display_override.length === 0) {
    throw new Error('Viewer manifest.json must declare display_override');
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length !== VIEWER_MANIFEST_ICONS.size) {
    throw new Error('Viewer manifest.json must declare the three FreeTV application icons');
  }
  const declaredIcons = new Set();
  for (const icon of manifest.icons) {
    if (!isObject(icon) || typeof icon.src !== 'string' || icon.src === '') {
      throw new Error('Viewer manifest.json contains an icon without a source');
    }
    const expected = VIEWER_MANIFEST_ICONS.get(icon.src);
    if (!expected) throw new Error(`Viewer manifest.json contains an unexpected icon: ${icon.src}`);
    declaredIcons.add(icon.src);
    const validPurpose = expected.purpose === undefined
      ? icon.purpose === undefined || icon.purpose === 'any'
      : icon.purpose === expected.purpose;
    if (icon.type !== 'image/png' || icon.sizes !== `${expected.width}x${expected.height}` || !validPurpose) {
      throw new Error(`Viewer manifest.json icon contract is invalid: ${icon.src}`);
    }
    const relativeIcon = icon.src.split(/[?#]/u)[0].replace(/^\/+/, '');
    const iconPath = path.resolve(viewerDist, relativeIcon);
    if (!isWithin(iconPath, viewerDist) || !fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) {
      throw new Error(`Viewer manifest icon does not resolve inside dist: ${icon.src}`);
    }
    const dimensions = readPngDimensions(iconPath);
    if (!dimensions || dimensions.width !== expected.width || dimensions.height !== expected.height) {
      throw new Error(`Viewer manifest icon PNG dimensions are invalid: ${icon.src}`);
    }
  }
  for (const iconPath of VIEWER_MANIFEST_ICONS.keys()) {
    if (!declaredIcons.has(iconPath)) throw new Error(`Viewer manifest.json is missing required icon: ${iconPath}`);
  }
}

export function validateViewerSpaHtaccess(filePath, label = 'Viewer .htaccess') {
  requirePath(filePath, 'file', label);
  const contents = fs.readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
  if (contents !== VIEWER_SPA_HTACCESS) {
    throw new Error(`${label} does not match the Viewer SPA fallback contract`);
  }
}

export function validateViewerDist(viewerDist) {
  requirePath(viewerDist, 'directory', 'Viewer dist');
  assertNoSymlinks(viewerDist, 'Viewer dist');
  assertExactEntries(viewerDist, VIEWER_ROOT_ENTRIES, 'Viewer dist');
  validateViewerSpaHtaccess(path.join(viewerDist, '.htaccess'));
  requirePath(path.join(viewerDist, 'index.html'), 'file', 'Viewer index.html');
  requirePath(path.join(viewerDist, 'manifest.json'), 'file', 'Viewer manifest.json');
  requirePath(path.join(viewerDist, 'service-worker.js'), 'file', 'Viewer service-worker.js');
  validateFrontendAssets(viewerDist, 'Viewer dist');
  validateViewerManifest(viewerDist);
}

export function validateAdminDist(adminDist) {
  requirePath(adminDist, 'directory', 'Server Admin dist');
  assertNoSymlinks(adminDist, 'Server Admin dist');
  assertExactEntries(adminDist, ADMIN_ROOT_ENTRIES, 'Server Admin dist');
  requirePath(path.join(adminDist, 'index.html'), 'file', 'Server Admin index.html');
  validateFrontendAssets(adminDist, 'Server Admin dist');
}

function assertNoOutputSymlinkAncestors(outputRoot, boundary) {
  let current = outputRoot;
  while (isWithin(current, boundary, true)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing production output through symbolic-link path: ${current}`);
    }
    if (current === boundary) break;
    current = path.dirname(current);
  }
}

function pathsOverlap(left, right) {
  return isWithin(left, right, true) || isWithin(right, left, true);
}

export function resolveAssemblyPaths(toolingRoot, config) {
  if (!isObject(config.repos) || !isObject(config.staging) || !isObject(config.output)) {
    throw new Error('Assembly config must define repos, staging, and output objects');
  }
  for (const key of ['viewer', 'server']) {
    if (typeof config.repos[key] !== 'string' || config.repos[key].trim() === '') {
      throw new Error(`config.repos.${key} must be a non-empty path`);
    }
  }
  if (typeof config.output.root !== 'string' || config.output.root.trim() === '') {
    throw new Error('config.output.root must be a non-empty path');
  }

  const resolvedToolingRoot = path.resolve(toolingRoot);
  const viewerRoot = path.resolve(resolvedToolingRoot, config.repos.viewer);
  const serverRoot = path.resolve(resolvedToolingRoot, config.repos.server);
  const stagingRoot = path.resolve(resolvedToolingRoot, config.staging.root ?? '');
  const dataStagingRoot = path.resolve(stagingRoot, config.staging.data ?? '');
  const thumbnailStagingRoot = path.resolve(stagingRoot, config.staging.thumbnails ?? '');
  const outputBoundary = path.resolve(resolvedToolingRoot, '..', 'production');
  const outputRoot = path.resolve(resolvedToolingRoot, config.output.root);

  if (outputRoot === path.parse(outputRoot).root) throw new Error('Production output root must not be the filesystem root');
  if (!isWithin(outputRoot, outputBoundary, true)) {
    throw new Error(`Production output must be inside the expected Tooling-owned boundary: ${outputBoundary}`);
  }
  const protectedRoots = [resolvedToolingRoot, viewerRoot, serverRoot, stagingRoot, dataStagingRoot, thumbnailStagingRoot];
  for (const protectedRoot of protectedRoots) {
    if (pathsOverlap(outputRoot, protectedRoot)) {
      throw new Error(`Production output must not overlap a source or staging root: ${protectedRoot}`);
    }
  }
  assertNoOutputSymlinkAncestors(outputRoot, outputBoundary);

  return {
    toolingRoot: resolvedToolingRoot,
    viewerRoot,
    serverRoot,
    stagingRoot,
    dataStagingRoot,
    thumbnailStagingRoot,
    outputBoundary,
    outputRoot,
    publicRoot: path.join(outputRoot, 'public'),
  };
}

export class OwnershipRegistry {
  constructor() {
    this.claims = new Map();
  }

  claim(destination, owner) {
    const resolved = path.resolve(destination);
    const existing = this.claims.get(resolved);
    if (existing) throw new Error(`Destination collision at ${resolved}: ${existing} and ${owner}`);
    this.claims.set(resolved, owner);
  }
}

function copyFileOwned(source, destination, owner, ownership) {
  ownership.claim(destination, owner);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode);
}

function copyTreeOwned(sourceRoot, destinationRoot, owner, ownership, entries = walk(sourceRoot)) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const { entry, relativePath, absolutePath } of entries) {
    const destination = path.join(destinationRoot, relativePath);
    if (entry.isDirectory()) fs.mkdirSync(destination, { recursive: true });
    else if (entry.isFile()) copyFileOwned(absolutePath, destination, owner, ownership);
    else throw new Error(`${owner} source contains unsupported filesystem entry: ${relativePath}`);
  }
}

function classifyApiEntry(entry, relativePath) {
  const segments = relativePath.split(path.sep).map((segment) => segment.toLowerCase());
  const basename = segments.at(-1);
  const normalizedPath = segments.join('/');
  if (entry.isDirectory() && API_EXCLUDED_DIRECTORIES.has(basename)) return 'exclude';
  if (segments.some((segment) => API_EXCLUDED_DIRECTORIES.has(segment))) return 'exclude';
  if (entry.isDirectory()) {
    if (!API_ALLOWED_DIRECTORIES.has(normalizedPath)) {
      throw new Error(`Server API contains an unreviewed runtime directory: ${relativePath}`);
    }
    return 'include';
  }
  if (basename === 'beacon.php' || basename === '.env' || basename.startsWith('.env.')) return 'exclude';
  if (basename.includes('credential') || basename.startsWith('.prepared-') || basename.endsWith('~')
    || API_EXCLUDED_EXTENSIONS.has(path.extname(basename))) return 'exclude';
  if (!API_ALLOWED_EXTENSIONS.has(path.extname(basename))) {
    throw new Error(`Server API contains an unreviewed runtime file type: ${relativePath}`);
  }
  return 'include';
}

function collectApiEntries(apiRoot) {
  const included = [];
  const exclusions = [];
  for (const item of walk(apiRoot)) {
    const classification = classifyApiEntry(item.entry, item.relativePath);
    if (classification === 'exclude') exclusions.push(item.relativePath);
    else included.push(item);
  }
  return { included, exclusions };
}

function collectVendorEntries(vendorRoot) {
  const included = [];
  const exclusions = [];
  for (const item of walk(vendorRoot)) {
    const segments = item.relativePath.split(path.sep).map((segment) => segment.toLowerCase());
    if (segments.some((segment) => VENDOR_EXCLUDED_DIRECTORIES.has(segment))) {
      exclusions.push(item.relativePath);
    } else {
      included.push(item);
    }
  }
  return { included, exclusions };
}

function assertTreeHasNoSecretsOrSymlinks(root, label) {
  assertNoSymlinks(root, label);
  for (const { entry, relativePath } of walk(root)) {
    if (!entry.isFile()) continue;
    const basename = path.basename(relativePath).toLowerCase();
    if (basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.key')) {
      throw new Error(`${label} contains forbidden credential content: ${relativePath}`);
    }
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyManifestFiles(manifest, destinationRoot, label) {
  for (const entry of manifest.files) {
    const destination = path.resolve(destinationRoot, entry.path);
    if (!isWithin(destination, destinationRoot)) throw new Error(`${label} destination escapes public root: ${entry.path}`);
    requirePath(destination, 'file', `${label} assembled file`);
    const bytes = fs.statSync(destination).size;
    if (bytes !== entry.bytes) {
      throw new Error(`${label} assembled byte size mismatch for ${entry.path}: expected ${entry.bytes}, got ${bytes}`);
    }
    if (sha256(destination) !== entry.sha256) {
      throw new Error(`${label} assembled SHA-256 mismatch for ${entry.path}`);
    }
  }
}

function validateManifestOwnership(dataManifest, thumbnailManifest) {
  for (const entry of dataManifest.files) {
    if (entry.path !== 'config.json' && !/^playlists\/[^/]+\.json$/u.test(entry.path)) {
      throw new Error(`Data manifest contains a path outside Data ownership: ${entry.path}`);
    }
  }
  for (const entry of thumbnailManifest.files) {
    if (!/^thumbs\/[^/]+\.jpg$/u.test(entry.path)) {
      throw new Error(`Thumbnail manifest contains a path outside Thumbnail ownership: ${entry.path}`);
    }
  }
}

function assertEmptyDirectory(directory, label) {
  requirePath(directory, 'directory', label);
  if (fs.readdirSync(directory).length !== 0) throw new Error(`${label} must be empty`);
}

export function validateProductionOutput({ paths, dataManifest, thumbnailManifest }) {
  const { outputRoot, publicRoot } = paths;
  requirePath(outputRoot, 'directory', 'Production output');
  assertNoSymlinks(outputRoot, 'Production output');
  assertExactEntries(outputRoot, PRODUCTION_ROOT_ENTRIES, 'Production output');
  assertExactEntries(publicRoot, PUBLIC_ROOT_ENTRIES, 'Production public root');
  assertExactEntries(path.join(publicRoot, 'admin'), ADMIN_ROOT_ENTRIES, 'Production Admin root');
  assertExactEntries(path.join(outputRoot, 'temp'), TEMP_ROOT_ENTRIES, 'Production temp root');

  for (const relativePath of [
    'composer.json',
    'composer.lock',
    'vendor/autoload.php',
    'public/.htaccess',
    'public/index.html',
    'public/manifest.json',
    'public/service-worker.js',
    'public/admin/index.html',
    'public/config.json',
    'public/playlists/index.json',
  ]) requirePath(path.join(outputRoot, relativePath), 'file', `Production ${relativePath}`);

  validateViewerSpaHtaccess(path.join(publicRoot, '.htaccess'), 'Production public/.htaccess');

  for (const relativePath of ['public/assets', 'public/admin/assets', 'public/api', 'public/thumbs']) {
    requirePath(path.join(outputRoot, relativePath), 'directory', `Production ${relativePath}`);
  }

  assertEmptyDirectory(path.join(outputRoot, 'temp/publication-undo'), 'Publication Undo runtime directory');
  assertEmptyDirectory(path.join(outputRoot, 'temp/thumbnail-undo'), 'Thumbnail Undo runtime directory');
  validateFrontendAssets(publicRoot, 'Production Viewer');
  validateViewerManifest(publicRoot);
  validateFrontendAssets(path.join(publicRoot, 'admin'), 'Production Admin');

  for (const item of walk(path.join(publicRoot, 'api'))) {
    if (classifyApiEntry(item.entry, item.relativePath) !== 'include') {
      throw new Error(`Production API contains excluded content: ${item.relativePath}`);
    }
  }

  for (const { entry, relativePath } of walk(outputRoot)) {
    const segments = relativePath.split(path.sep).map((segment) => segment.toLowerCase());
    if (segments.some((segment) => VENDOR_EXCLUDED_DIRECTORIES.has(segment))) {
      throw new Error(`Production output contains forbidden development metadata: ${relativePath}`);
    }
    if (!entry.isFile()) continue;
    const basename = path.basename(relativePath).toLowerCase();
    if (basename === '.env' || basename.startsWith('.env.') || basename.endsWith('.key')) {
      throw new Error(`Production output contains forbidden credential content: ${relativePath}`);
    }
  }

  verifyManifestFiles(dataManifest, publicRoot, 'Data');
  verifyManifestFiles(thumbnailManifest, publicRoot, 'Thumbnail');
  return { fileCount: walk(outputRoot).filter(({ entry }) => entry.isFile()).length };
}

function validatePreconditions(paths) {
  const viewerDist = path.join(paths.viewerRoot, 'dist');
  const adminDist = path.join(paths.serverRoot, 'dist');
  const apiRoot = path.join(paths.serverRoot, 'public/api');
  const vendorRoot = path.join(paths.serverRoot, 'vendor');

  validateViewerDist(viewerDist);
  validateAdminDist(adminDist);
  const dataManifest = validateDataManifest(paths.dataStagingRoot);
  const thumbnailManifest = validateThumbnailManifest(paths.thumbnailStagingRoot);
  validateManifestOwnership(dataManifest, thumbnailManifest);

  requirePath(apiRoot, 'directory', 'Server public/api');
  requirePath(path.join(paths.serverRoot, 'composer.json'), 'file', 'Server composer.json');
  requirePath(path.join(paths.serverRoot, 'composer.lock'), 'file', 'Server composer.lock');
  requirePath(vendorRoot, 'directory', 'Server vendor');
  requirePath(path.join(vendorRoot, 'autoload.php'), 'file', 'Server vendor/autoload.php');
  assertTreeHasNoSecretsOrSymlinks(vendorRoot, 'Server vendor');
  assertNoSymlinks(apiRoot, 'Server API');
  const apiEntries = collectApiEntries(apiRoot);
  const vendorEntries = collectVendorEntries(vendorRoot);

  return {
    viewerDist,
    adminDist,
    apiRoot,
    vendorRoot,
    dataManifest,
    thumbnailManifest,
    apiEntries,
    vendorEntries,
  };
}

function resetProductionOutput(paths) {
  const checked = resolveAssemblyPaths(paths.toolingRoot, {
    repos: {
      viewer: path.relative(paths.toolingRoot, paths.viewerRoot),
      server: path.relative(paths.toolingRoot, paths.serverRoot),
    },
    staging: {
      root: path.relative(paths.toolingRoot, paths.stagingRoot),
      data: path.relative(paths.stagingRoot, paths.dataStagingRoot),
      thumbnails: path.relative(paths.stagingRoot, paths.thumbnailStagingRoot),
    },
    output: { root: path.relative(paths.toolingRoot, paths.outputRoot) },
  });
  fs.rmSync(checked.outputRoot, { recursive: true, force: true });
}

export function assembleProduction({ toolingRoot, config }) {
  const paths = resolveAssemblyPaths(toolingRoot, config);
  const inputs = validatePreconditions(paths);
  const ownership = new OwnershipRegistry();
  let outputStarted = false;

  try {
    resetProductionOutput(paths);
    outputStarted = true;
    fs.mkdirSync(paths.publicRoot, { recursive: true });

    copyTreeOwned(inputs.viewerDist, paths.publicRoot, 'Viewer', ownership);
    copyTreeOwned(inputs.adminDist, path.join(paths.publicRoot, 'admin'), 'Admin', ownership);
    copyTreeOwned(inputs.apiRoot, path.join(paths.publicRoot, 'api'), 'Server API', ownership, inputs.apiEntries.included);
    copyFileOwned(path.join(paths.serverRoot, 'composer.json'), path.join(paths.outputRoot, 'composer.json'), 'Composer', ownership);
    copyFileOwned(path.join(paths.serverRoot, 'composer.lock'), path.join(paths.outputRoot, 'composer.lock'), 'Composer', ownership);
    copyTreeOwned(
      inputs.vendorRoot,
      path.join(paths.outputRoot, 'vendor'),
      'Composer',
      ownership,
      inputs.vendorEntries.included,
    );

    for (const entry of inputs.dataManifest.files) {
      copyFileOwned(
        path.join(paths.dataStagingRoot, entry.path),
        path.join(paths.publicRoot, entry.path),
        'Data Export',
        ownership,
      );
    }
    for (const entry of inputs.thumbnailManifest.files) {
      copyFileOwned(
        path.join(paths.thumbnailStagingRoot, entry.path),
        path.join(paths.publicRoot, entry.path),
        'Thumbnail Export',
        ownership,
      );
    }

    fs.mkdirSync(path.join(paths.outputRoot, 'temp/publication-undo'), { recursive: true });
    fs.mkdirSync(path.join(paths.outputRoot, 'temp/thumbnail-undo'), { recursive: true });

    const validation = validateProductionOutput({
      paths,
      dataManifest: inputs.dataManifest,
      thumbnailManifest: inputs.thumbnailManifest,
    });
    return {
      paths,
      dataManifest: inputs.dataManifest,
      thumbnailManifest: inputs.thumbnailManifest,
      apiExclusions: inputs.apiEntries.exclusions,
      vendorExclusions: inputs.vendorEntries.exclusions,
      validation,
    };
  } catch (error) {
    if (outputStarted) resetProductionOutput(paths);
    throw error;
  }
}
