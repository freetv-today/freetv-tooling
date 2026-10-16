import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './lib/command-runner.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

function loadConfig(toolingRoot) {
  return JSON.parse(fs.readFileSync(path.join(toolingRoot, 'config/paths.json'), 'utf8'));
}

export async function runViewerBuild({
  toolingRoot = defaultToolingRoot,
  config = loadConfig(toolingRoot),
  environment = process.env,
  signal,
  commandRunner = runCommand,
  logger = console,
} = {}) {
  const viewerRoot = path.resolve(toolingRoot, config.repos.viewer);
  logger.log('Building FreeTV Viewer...');
  const result = await commandRunner({
    executable: 'npm', args: ['run', 'build'], cwd: viewerRoot,
    env: environment, stdio: 'inherit', signal,
  });
  logger.log('FreeTV Viewer build complete.');
  return { ...result, repositoryRoot: viewerRoot };
}

export async function runViewerBuildCli(options = {}) {
  try {
    await runViewerBuild(options);
    return 0;
  } catch (error) {
    (options.logger ?? console).error(`FreeTV Viewer build failed.\n\n${error.message}`);
    return error.kind === 'exit' ? error.exitCode : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await runViewerBuildCli();
}
