import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export function runStatusCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  fileSystem = fs,
  logger = console,
} = {}) {
  try {
    const config = configLoader(toolingRoot);
    const repos = Object.entries(config.repos).map(([name, rel]) => ({ name, abs: path.resolve(toolingRoot, rel) }));
    logger.log('FreeTV tooling status');
    logger.log('=====================');
    for (const repo of repos) logger.log(`${repo.name}: ${repo.abs} ${fileSystem.existsSync(repo.abs) ? '✓' : '✗'}`);
    logger.log(`output: ${path.resolve(toolingRoot, config.output.root)}`);
    return 0;
  } catch (error) {
    logger.error(`FreeTV tooling status failed: ${error.message}`);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) process.exitCode = runStatusCli();
