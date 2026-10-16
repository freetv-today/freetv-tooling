import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './lib/command-runner.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

function loadConfig(toolingRoot) {
  return JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));
}

export async function runAdminBuild({
  toolingRoot = defaultToolingRoot,
  config = loadConfig(toolingRoot),
  environment = process.env,
  signal,
  commandRunner = runCommand,
  logger = console,
} = {}) {
  const adminRoot = path.resolve(toolingRoot, config.repos.admin);
  logger.log('Building FreeTV Admin Dashboard...');
  const result = await commandRunner({
    executable: 'npm', args: ['run', 'build'], cwd: adminRoot,
    env: environment, stdio: 'inherit', signal,
  });
  logger.log('FreeTV Admin Dashboard build complete.');
  return { ...result, repositoryRoot: adminRoot };
}

export async function runAdminBuildCli(options = {}) {
  try {
    await runAdminBuild(options);
    return 0;
  } catch (error) {
    (options.logger ?? console).error(`FreeTV Admin Dashboard build failed.\n\n${error.message}`);
    return error.kind === 'exit' ? error.exitCode : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runAdminBuildCli();
}
