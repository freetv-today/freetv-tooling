import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');
const usage = 'Usage: npm run clean:thumbs [-- --apply]';

export function validateThumbnailCleanupArguments(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && args[0] === '--apply') return ['--apply'];
  throw new Error(`Unsupported thumbnail cleanup arguments.\n${usage}`);
}

export function resolveThumbnailCleanup(toolingRoot, fileSystem = fs) {
  const configPath = path.join(toolingRoot, 'config/paths.json');
  if (!fileSystem.existsSync(configPath) || !fileSystem.statSync(configPath).isFile()) {
    throw new Error(`Tooling paths configuration was not found: ${configPath}`);
  }

  const config = JSON.parse(fileSystem.readFileSync(configPath, 'utf8'));
  if (typeof config.repos?.server !== 'string' || config.repos.server.trim() === '') {
    throw new Error(`Tooling paths configuration does not define repos.server: ${configPath}`);
  }

  const serverRoot = path.resolve(toolingRoot, config.repos.server);
  if (!fileSystem.existsSync(serverRoot) || !fileSystem.statSync(serverRoot).isDirectory()) {
    throw new Error(`FreeTV Server repository was not found: ${serverRoot}`);
  }

  const cleanupScript = path.join(serverRoot, 'scripts/cleanup-orphan-thumbnails.php');
  if (!fileSystem.existsSync(cleanupScript) || !fileSystem.statSync(cleanupScript).isFile()) {
    throw new Error(`FreeTV Server thumbnail cleanup script was not found: ${cleanupScript}`);
  }

  return { cleanupScript, serverRoot };
}

export function runThumbnailCleanup({
  args = [],
  commandRunner = spawnSync,
  toolingRoot = defaultToolingRoot,
} = {}) {
  const cleanupArguments = validateThumbnailCleanupArguments(args);
  const { cleanupScript, serverRoot } = resolveThumbnailCleanup(toolingRoot);
  const result = commandRunner('php', [cleanupScript, ...cleanupArguments], {
    cwd: serverRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Could not start the FreeTV Server thumbnail cleanup: ${result.error.message}`);
  }
  return Number.isInteger(result.status) ? result.status : 1;
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  try {
    process.exitCode = runThumbnailCleanup({ args: process.argv.slice(2) });
  } catch (error) {
    console.error(`Thumbnail cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
