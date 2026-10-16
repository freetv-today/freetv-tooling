import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateDataManifest, validateThumbnailManifest } from './export-staging.js';

const VIEWER_ROOT_ENTRIES = new Set([
  '.htaccess',
  'assets',
  'freetv-small.png',
  'freetv.png',
  'index.html',
  'service-worker.js',
  'whitelabel.config.json',
]);
const ADMIN_ROOT_ENTRIES = new Set(['assets', 'index.html']);
const PRODUCTION_ROOT_ENTRIES = new Set([
  'composer.json', 'composer.lock', 'public', 'resources', 'sql', 'temp', 'vendor',
]);
const PUBLIC_ROOT_ENTRIES = new Set([
  '.htaccess',
  'admin',
  'api',
  'assets',
  'config.json',
  'freetv-small.png',
  'freetv.png',
  'index.html',
  'playlists',
  'service-worker.js',
  'thumbs',
  'whitelabel.config.json',
]);
const TEMP_ROOT_ENTRIES = new Set(['publication-undo', 'thumbnail-undo']);
export const FIRST_RUN_RUNTIME_FILES = Object.freeze([
  'resources/bootstrap/fresh.json',
  'resources/freetv-baseline-sample-data.zip',
  'sql/freetv_mariadb_schema-tables-only.sql',
]);
const FIRST_RUN_RESOURCES_ROOT_ENTRIES = new Set(['bootstrap', 'freetv-baseline-sample-data.zip']);
const FIRST_RUN_BOOTSTRAP_ENTRIES = new Set(['fresh.json']);
const FIRST_RUN_SQL_ENTRIES = new Set(['freetv_mariadb_schema-tables-only.sql']);
const FRONTEND_ASSET_EXTENSIONS = new Set([
  '.css', '.gif', '.html', '.jpg', '.js', '.nfo', '.png', '.svg', '.ttf', '.woff', '.woff2',
]);
const API_ALLOWED_EXTENSIONS = new Set(['.html', '.php']);
const API_ALLOWED_DIRECTORIES = new Set(['admin', 'admin/publication']);
const API_EXCLUDED_DIRECTORIES = new Set(['backup', 'backups', 'temp', 'tests', 'test', 'tmp']);
const API_EXCLUDED_EXTENSIONS = new Set([
  '.bak', '.backup', '.crt', '.dump', '.key', '.old', '.orig', '.p12', '.pem', '.pfx', '.sql', '.swp', '.tmp',
]);
const VENDOR_EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'test', 'tests', 'tools']);
export const VIEWER_SPA_HTACCESS = `RewriteEngine On
RewriteBase /

# Redirect old /v4/ directory to root
RewriteRule ^v4/(.*)$ https://freetv.today/ [R=301,L]

# Admin Dashboard SPA routes
RewriteCond %{REQUEST_URI} ^/admin(?:/|$)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^admin(?:/.*)?$ /admin/index.html [L]

# Never route API requests through the Viewer SPA fallback
RewriteRule ^api(?:/|$) - [L]

# Viewer SPA routes
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
  requirePath(path.join(viewerDist, 'service-worker.js'), 'file', 'Viewer service-worker.js');
  requirePath(path.join(viewerDist, 'freetv-small.png'), 'file', 'Viewer small logo');
  requirePath(path.join(viewerDist, 'freetv.png'), 'file', 'Viewer logo');
  requirePath(path.join(viewerDist, 'whitelabel.config.json'), 'file', 'Viewer white-label config');
  validateFrontendAssets(viewerDist, 'Viewer dist');
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
  for (const key of ['viewer', 'admin']) {
    if (typeof config.repos[key] !== 'string' || config.repos[key].trim() === '') {
      throw new Error(`config.repos.${key} must be a non-empty path`);
    }
  }
  if (typeof config.output.root !== 'string' || config.output.root.trim() === '') {
    throw new Error('config.output.root must be a non-empty path');
  }

  const resolvedToolingRoot = path.resolve(toolingRoot);
  const viewerRoot = path.resolve(resolvedToolingRoot, config.repos.viewer);
  const adminRoot = path.resolve(resolvedToolingRoot, config.repos.admin);
  const stagingRoot = path.resolve(resolvedToolingRoot, config.staging.root ?? '');
  const dataStagingRoot = path.resolve(stagingRoot, config.staging.data ?? '');
  const thumbnailStagingRoot = path.resolve(stagingRoot, config.staging.thumbnails ?? '');
  const outputBoundary = path.resolve(resolvedToolingRoot, '..', 'production');
  const outputRoot = path.resolve(resolvedToolingRoot, config.output.root);

  if (outputRoot === path.parse(outputRoot).root) throw new Error('Production output root must not be the filesystem root');
  if (!isWithin(outputRoot, outputBoundary, true)) {
    throw new Error(`Production output must be inside the expected Tooling-owned boundary: ${outputBoundary}`);
  }
  const protectedRoots = [resolvedToolingRoot, viewerRoot, adminRoot, stagingRoot, dataStagingRoot, thumbnailStagingRoot];
  for (const protectedRoot of protectedRoots) {
    if (pathsOverlap(outputRoot, protectedRoot)) {
      throw new Error(`Production output must not overlap a source or staging root: ${protectedRoot}`);
    }
  }
  assertNoOutputSymlinkAncestors(outputRoot, outputBoundary);

  return {
    toolingRoot: resolvedToolingRoot,
    viewerRoot,
    adminRoot,
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

function copyFileOwned(source, destination, owner, ownership, hooks = {}) {
  ownership.claim(destination, owner);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode);
  hooks.afterCandidateCopy?.({ source, destination, owner });
}

function copyTreeOwned(
  sourceRoot,
  destinationRoot,
  owner,
  ownership,
  entries = walk(sourceRoot),
  hooks = {},
) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const { entry, relativePath, absolutePath } of entries) {
    const destination = path.join(destinationRoot, relativePath);
    if (entry.isDirectory()) fs.mkdirSync(destination, { recursive: true });
    else if (entry.isFile()) copyFileOwned(absolutePath, destination, owner, ownership, hooks);
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
  assertExactEntries(
    path.join(outputRoot, 'resources'),
    FIRST_RUN_RESOURCES_ROOT_ENTRIES,
    'Production First Run resources',
  );
  assertExactEntries(
    path.join(outputRoot, 'resources/bootstrap'),
    FIRST_RUN_BOOTSTRAP_ENTRIES,
    'Production Fresh bootstrap resources',
  );
  assertExactEntries(path.join(outputRoot, 'sql'), FIRST_RUN_SQL_ENTRIES, 'Production First Run SQL');
  assertExactEntries(path.join(outputRoot, 'temp'), TEMP_ROOT_ENTRIES, 'Production temp root');

  for (const relativePath of [
    'composer.json',
    'composer.lock',
    'vendor/autoload.php',
    ...FIRST_RUN_RUNTIME_FILES,
    'public/.htaccess',
    'public/index.html',
    'public/service-worker.js',
    'public/freetv-small.png',
    'public/freetv.png',
    'public/whitelabel.config.json',
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
  const adminDist = path.join(paths.adminRoot, 'dist');
  const apiRoot = path.join(paths.adminRoot, 'public/api');
  const vendorRoot = path.join(paths.adminRoot, 'vendor');

  validateViewerDist(viewerDist);
  validateAdminDist(adminDist);
  const dataManifest = validateDataManifest(paths.dataStagingRoot);
  const thumbnailManifest = validateThumbnailManifest(paths.thumbnailStagingRoot);
  validateManifestOwnership(dataManifest, thumbnailManifest);

  requirePath(apiRoot, 'directory', 'Server public/api');
  requirePath(path.join(paths.adminRoot, 'composer.json'), 'file', 'Server composer.json');
  requirePath(path.join(paths.adminRoot, 'composer.lock'), 'file', 'Server composer.lock');
  for (const relativePath of FIRST_RUN_RUNTIME_FILES) {
    requirePath(
      path.join(paths.adminRoot, relativePath),
      'file',
      `Server First Run runtime input ${relativePath}`,
    );
  }
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

const ASSEMBLY_TRANSACTION_CONTRACT = 'freetv-tooling-production-assembly-v1';

function pathEntryExists(candidate, fileSystem = fs) {
  try {
    fileSystem.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function transactionPrefix(outputRoot) {
  const basename = path.basename(outputRoot);
  if (!/^[A-Za-z0-9._-]+$/u.test(basename) || basename === '.' || basename === '..') {
    throw new Error(`Production output basename is unsafe for assembly transactions: ${basename}`);
  }
  return `.freetv-tooling-${basename}-assembly-`;
}

function createTransaction(paths, transactionId, fileSystem) {
  if (!/^[a-f0-9]{24}$/u.test(transactionId)) {
    throw new Error('Production assembly transaction ID is unsafe');
  }
  const parent = path.dirname(paths.outputRoot);
  const prefix = transactionPrefix(paths.outputRoot);
  fileSystem.mkdirSync(parent, { recursive: true });
  if (fileSystem.lstatSync(parent).isSymbolicLink() || !fileSystem.lstatSync(parent).isDirectory()) {
    throw new Error(`Production output parent is unsafe: ${parent}`);
  }
  const stem = `${prefix}${transactionId}`;
  const transaction = {
    contract: ASSEMBLY_TRANSACTION_CONTRACT,
    id: transactionId,
    outputRoot: paths.outputRoot,
    claimPath: path.join(parent, `${prefix}claim`),
    candidatePath: path.join(parent, `${stem}.candidate`),
    backupPath: path.join(parent, `${stem}.backup`),
    markerPath: path.join(parent, `${stem}.transaction.json`),
  };
  for (const candidate of [
    transaction.claimPath,
    transaction.candidatePath,
    transaction.backupPath,
    transaction.markerPath,
  ]) {
    if (path.dirname(candidate) !== parent || pathEntryExists(candidate, fileSystem)) {
      if (candidate === transaction.claimPath) {
        throw new Error(`Production assembly is already claimed or requires manual recovery: ${candidate}`);
      }
      throw new Error(`Production assembly transaction path collision: ${candidate}`);
    }
  }
  try {
    fileSystem.writeFileSync(
      transaction.claimPath,
      `${JSON.stringify(transaction, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(
        `Production assembly is already claimed or requires manual recovery: ${transaction.claimPath}`,
        { cause: error },
      );
    }
    throw error;
  }

  const existing = fileSystem.readdirSync(parent).filter(
    (name) => name.startsWith(prefix) && path.join(parent, name) !== transaction.claimPath,
  );
  if (existing.length > 0) {
    throw new Error(
      `Existing production assembly transaction requires manual inspection; claim retained at ${transaction.claimPath}: ${existing.map((name) => path.join(parent, name)).join(', ')}`,
    );
  }

  let markerCreated = false;
  try {
    fileSystem.writeFileSync(
      transaction.markerPath,
      `${JSON.stringify(transaction, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    markerCreated = true;
    fileSystem.mkdirSync(transaction.candidatePath, { mode: 0o700 });
  } catch (error) {
    let cleanupError;
    try {
      if (markerCreated) fileSystem.unlinkSync(transaction.markerPath);
      fileSystem.unlinkSync(transaction.claimPath);
    } catch (caught) {
      cleanupError = caught;
    }
    if (cleanupError) {
      throw new Error(
        `Production assembly transaction setup failed and its exclusive claim was retained at ${transaction.claimPath}: ${error.message}; cleanup failed: ${cleanupError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
  return transaction;
}

function readOwnedTransactionRecord(transaction, recordPath, label, fileSystem) {
  if (!pathEntryExists(recordPath, fileSystem)
    || fileSystem.lstatSync(recordPath).isSymbolicLink()
    || !fileSystem.lstatSync(recordPath).isFile()) {
    throw new Error(`Production assembly ${label} is missing or unsafe: ${recordPath}`);
  }
  let recorded;
  try {
    recorded = JSON.parse(fileSystem.readFileSync(recordPath, 'utf8'));
  } catch (error) {
    throw new Error(`Production assembly ${label} is invalid: ${recordPath}: ${error.message}`);
  }
  for (const key of [
    'contract', 'id', 'outputRoot', 'claimPath', 'candidatePath', 'backupPath', 'markerPath',
  ]) {
    if (recorded[key] !== transaction[key]) {
      throw new Error(`Production assembly ${label} does not match this operation: ${recordPath}`);
    }
  }
}

function assertOwnedTransactionPath(transaction, target, fileSystem) {
  readOwnedTransactionRecord(transaction, transaction.claimPath, 'ownership claim', fileSystem);
  readOwnedTransactionRecord(transaction, transaction.markerPath, 'ownership marker', fileSystem);
  if (![transaction.candidatePath, transaction.backupPath].includes(target)
    || path.dirname(target) !== path.dirname(transaction.outputRoot)) {
    throw new Error(`Refusing to clean an unowned production assembly path: ${target}`);
  }
  if (!pathEntryExists(target, fileSystem) || fileSystem.lstatSync(target).isSymbolicLink()
    || !fileSystem.lstatSync(target).isDirectory()) {
    throw new Error(`Owned production assembly path is missing or unsafe: ${target}`);
  }
}

function removeOwnedTransactionPath(transaction, target, fileSystem) {
  assertOwnedTransactionPath(transaction, target, fileSystem);
  fileSystem.rmSync(target, { recursive: true, force: false });
}

function finishTransaction(transaction, fileSystem) {
  readOwnedTransactionRecord(transaction, transaction.claimPath, 'ownership claim', fileSystem);
  readOwnedTransactionRecord(transaction, transaction.markerPath, 'ownership marker', fileSystem);
  fileSystem.unlinkSync(transaction.markerPath);
  fileSystem.unlinkSync(transaction.claimPath);
}

function candidatePaths(paths, candidatePath) {
  return { ...paths, outputRoot: candidatePath, publicRoot: path.join(candidatePath, 'public') };
}

function cleanCandidateAfterFailure(transaction, fileSystem, originalError, label) {
  try {
    if (pathEntryExists(transaction.candidatePath, fileSystem)) {
      removeOwnedTransactionPath(transaction, transaction.candidatePath, fileSystem);
    }
    finishTransaction(transaction, fileSystem);
  } catch (cleanupError) {
    throw new Error(
      `${label}: ${originalError.message}; candidate or transaction cleanup failed; inspect any remaining state at candidate ${transaction.candidatePath}, marker ${transaction.markerPath}, and claim ${transaction.claimPath}: ${cleanupError.message}`,
      { cause: originalError },
    );
  }
  throw new Error(`${label}; previous production output is intact: ${originalError.message}`, { cause: originalError });
}

export function assembleProduction({
  toolingRoot,
  config,
  transactionId = crypto.randomBytes(12).toString('hex'),
  transactionFileSystem = fs,
  transactionHooks = {},
}) {
  const paths = resolveAssemblyPaths(toolingRoot, config);
  const inputs = validatePreconditions(paths);
  const ownership = new OwnershipRegistry();
  const transaction = createTransaction(paths, transactionId, transactionFileSystem);
  const assemblyPaths = candidatePaths(paths, transaction.candidatePath);
  let validation;

  try {
    fs.mkdirSync(assemblyPaths.publicRoot, { recursive: true });

    copyTreeOwned(inputs.viewerDist, assemblyPaths.publicRoot, 'Viewer', ownership, undefined, transactionHooks);
    copyTreeOwned(inputs.adminDist, path.join(assemblyPaths.publicRoot, 'admin'), 'Admin', ownership, undefined, transactionHooks);
    copyTreeOwned(inputs.apiRoot, path.join(assemblyPaths.publicRoot, 'api'), 'Server API', ownership, inputs.apiEntries.included, transactionHooks);
    copyFileOwned(path.join(paths.adminRoot, 'composer.json'), path.join(assemblyPaths.outputRoot, 'composer.json'), 'Composer', ownership, transactionHooks);
    copyFileOwned(path.join(paths.adminRoot, 'composer.lock'), path.join(assemblyPaths.outputRoot, 'composer.lock'), 'Composer', ownership, transactionHooks);
    for (const relativePath of FIRST_RUN_RUNTIME_FILES) {
      copyFileOwned(
        path.join(paths.adminRoot, relativePath),
        path.join(assemblyPaths.outputRoot, relativePath),
        'Server First Run',
        ownership,
        transactionHooks,
      );
    }
    copyTreeOwned(
      inputs.vendorRoot,
      path.join(assemblyPaths.outputRoot, 'vendor'),
      'Composer',
      ownership,
      inputs.vendorEntries.included,
      transactionHooks,
    );

    for (const entry of inputs.dataManifest.files) {
      copyFileOwned(
        path.join(paths.dataStagingRoot, entry.path),
        path.join(assemblyPaths.publicRoot, entry.path),
        'Data Export',
        ownership,
        transactionHooks,
      );
    }
    for (const entry of inputs.thumbnailManifest.files) {
      copyFileOwned(
        path.join(paths.thumbnailStagingRoot, entry.path),
        path.join(assemblyPaths.publicRoot, entry.path),
        'Thumbnail Export',
        ownership,
        transactionHooks,
      );
    }

    fs.mkdirSync(path.join(assemblyPaths.outputRoot, 'temp/publication-undo'), { recursive: true });
    fs.mkdirSync(path.join(assemblyPaths.outputRoot, 'temp/thumbnail-undo'), { recursive: true });

    transactionHooks.beforeCandidateValidation?.({ paths: assemblyPaths, transaction });
    validation = validateProductionOutput({
      paths: assemblyPaths,
      dataManifest: inputs.dataManifest,
      thumbnailManifest: inputs.thumbnailManifest,
    });
  } catch (error) {
    cleanCandidateAfterFailure(
      transaction,
      transactionFileSystem,
      error,
      'Production assembly candidate failed; previous production output is intact',
    );
  }

  const hadPreviousOutput = pathEntryExists(paths.outputRoot, transactionFileSystem);
  if (hadPreviousOutput && (transactionFileSystem.lstatSync(paths.outputRoot).isSymbolicLink()
    || !transactionFileSystem.lstatSync(paths.outputRoot).isDirectory())) {
    cleanCandidateAfterFailure(
      transaction,
      transactionFileSystem,
      new Error(`Existing production output is not a safe directory: ${paths.outputRoot}`),
      'Production assembly promotion refused',
    );
  }

  if (hadPreviousOutput) {
    try {
      transactionHooks.beforeBackupRename?.({ paths, transaction });
      transactionFileSystem.renameSync(paths.outputRoot, transaction.backupPath);
    } catch (error) {
      if (pathEntryExists(paths.outputRoot, transactionFileSystem)
        && !pathEntryExists(transaction.backupPath, transactionFileSystem)) {
        cleanCandidateAfterFailure(
          transaction,
          transactionFileSystem,
          error,
          'Production assembly could not move the previous output to backup',
        );
      }
      throw new Error(
        `Production assembly backup state is ambiguous; manual recovery required. Output: ${paths.outputRoot}; backup: ${transaction.backupPath}; candidate: ${transaction.candidatePath}; marker: ${transaction.markerPath}; claim: ${transaction.claimPath}: ${error.message}`,
        { cause: error },
      );
    }
  }

  try {
    transactionHooks.beforeCandidatePromotion?.({ paths, transaction });
    transactionFileSystem.renameSync(transaction.candidatePath, paths.outputRoot);
  } catch (promotionError) {
    if (!hadPreviousOutput) {
      throw new Error(
        `Production assembly candidate promotion failed; candidate retained at ${transaction.candidatePath} with marker ${transaction.markerPath} and claim ${transaction.claimPath}: ${promotionError.message}`,
        { cause: promotionError },
      );
    }
    try {
      if (pathEntryExists(paths.outputRoot, transactionFileSystem)) {
        throw new Error(`Unexpected path appeared at the production output: ${paths.outputRoot}`);
      }
      transactionHooks.beforePreviousOutputRestore?.({ paths, transaction });
      transactionFileSystem.renameSync(transaction.backupPath, paths.outputRoot);
    } catch (restoreError) {
      throw new Error(
        `Production assembly promotion failed and recovery is incomplete; previous output backup retained at ${transaction.backupPath}; candidate retained at ${transaction.candidatePath}; marker retained at ${transaction.markerPath}; claim retained at ${transaction.claimPath}: ${promotionError.message}; restore failed: ${restoreError.message}`,
        { cause: promotionError },
      );
    }
    try {
      if (pathEntryExists(transaction.candidatePath, transactionFileSystem)) {
        removeOwnedTransactionPath(transaction, transaction.candidatePath, transactionFileSystem);
      }
      finishTransaction(transaction, transactionFileSystem);
    } catch (cleanupError) {
      throw new Error(
        `Production assembly promotion failed and the previous output was restored, but transaction cleanup failed; inspect any remaining candidate or diagnostics at ${transaction.candidatePath}, ${transaction.markerPath}, and ${transaction.claimPath}: ${cleanupError.message}`,
        { cause: promotionError },
      );
    }
    throw new Error(
      `Production assembly candidate promotion failed; previous production output was restored: ${promotionError.message}`,
      { cause: promotionError },
    );
  }

  if (hadPreviousOutput) {
    try {
      transactionHooks.beforeBackupCleanup?.({ paths, transaction });
      removeOwnedTransactionPath(transaction, transaction.backupPath, transactionFileSystem);
    } catch (cleanupError) {
      throw new Error(
        `Production assembly succeeded and the new output is valid, but backup cleanup failed and may have partially removed the previous backup; any remaining backup state is retained at ${transaction.backupPath}; diagnostics and exclusive claim are retained at ${transaction.markerPath} and ${transaction.claimPath}: ${cleanupError.message}`,
        { cause: cleanupError },
      );
    }
  }
  try {
    finishTransaction(transaction, transactionFileSystem);
  } catch (cleanupError) {
    throw new Error(
      `Production assembly succeeded and the new output is valid, but transaction cleanup failed; retained claim or diagnostics require manual inspection at ${transaction.claimPath} and ${transaction.markerPath}: ${cleanupError.message}`,
      { cause: cleanupError },
    );
  }

  return {
    paths,
    dataManifest: inputs.dataManifest,
    thumbnailManifest: inputs.thumbnailManifest,
    apiExclusions: inputs.apiEntries.exclusions,
    vendorExclusions: inputs.vendorEntries.exclusions,
    validation,
  };
}
