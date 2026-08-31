import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishDataset } from './lib/data-publication.js';

const scriptPath = fileURLToPath(import.meta.url);
const defaultToolingRoot = path.resolve(path.dirname(scriptPath), '..');

function snapshotArgument(args) {
  if (args.length !== 1 || !args[0].startsWith('--snapshot=') || args[0].length === '--snapshot='.length) {
    throw new Error('Usage: npm run data:publish -- --snapshot=<PATH>');
  }
  return args[0].slice('--snapshot='.length);
}

export async function runDataPublishCli({
  args = process.argv.slice(2),
  toolingRoot = defaultToolingRoot,
  configLoader = (root) => JSON.parse(fs.readFileSync(path.join(root, 'config/paths.json'), 'utf8')),
  publisher = publishDataset,
  logger = console,
} = {}) {
  try {
    const snapshotPath = snapshotArgument(args);
    const config = configLoader(toolingRoot);
    const result = await publisher({ toolingRoot, config, snapshotPath, logger });
    const counts = result.manifest.counts;
    logger.log([
      'Dataset published locally to freetv-data',
      '',
      `  Playlists:       ${counts.playlists}`,
      `  Shows:           ${counts.shows}`,
      `  Sample shows:    ${counts.sample_shows}`,
      `  Thumbnails:      ${counts.thumbnails}`,
      `  Thumbnail bytes: ${result.thumbnailBytes}`,
      '',
      `Updated: ${result.dataRoot}`,
      'No Git operations, GitHub release, or deployment occurred.',
    ].join('\n'));
    return 0;
  } catch (error) {
    if (error.message.includes('Mandatory validation gate returned NO GO')) {
      logger.error('NO GO — Dataset was not published');
    } else if (error.message.includes('rollback was incomplete')) {
      logger.error('Dataset publication failed and rollback was incomplete; inspect the retained recovery state');
    } else if (error.message.startsWith('Dataset was published locally, but ')
      || error.message.startsWith('Dataset was promoted, but ')) {
      logger.error('Dataset was published locally, but temporary publication cleanup failed');
    } else {
      logger.error('Dataset publication failed — freetv-data was not updated');
    }
    logger.error(error.message);
    return 1;
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runDataPublishCli();
}
