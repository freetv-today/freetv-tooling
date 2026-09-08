import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleasePackages } from './lib/release-packages.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

export async function runReleaseBuildCli({
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  builder = buildReleasePackages,
  logger = console,
} = {}) {
  try {
    const result = await builder({ toolingRoot, config: configLoader(toolingRoot), logger });
    logger.log([
      'Current First Run release packages built and validated',
      '',
      `  Sample:   ${result.sample.archivePath}`,
      `  Official: ${result.official.archivePath}`,
      '',
      'No Git operations, upload, GitHub release, or deployment occurred.',
    ].join('\n'));
    return 0;
  } catch (error) {
    logger.error(error.message.startsWith('Release packages were promoted, but ')
      ? 'Release packages were promoted, but temporary cleanup failed'
      : 'Release package generation failed — existing release ZIPs were not replaced');
    logger.error(error.message);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runReleaseBuildCli();
}
