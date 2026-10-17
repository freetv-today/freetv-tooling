import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as clack from '@clack/prompts';
import { runInteractiveCli } from './menu.js';

const scriptPath = fileURLToPath(import.meta.url);
const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export async function runCli(options = {}) {
  return runInteractiveCli({
    applicationName: 'FreeTV Tooling',
    version: packageMetadata.version,
    prompts: clack,
    ...options,
  });
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runCli();
}
