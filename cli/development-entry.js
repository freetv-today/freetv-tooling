import readline from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEVELOPMENT_SELECTIONS, runDevelopmentEnvironmentCli } from '../scripts/dev-all.js';

const scriptPath = fileURLToPath(import.meta.url);

export function parseDevelopmentSelection(args = []) {
  if (args.length !== 1 || !args[0].startsWith('--selection=')) {
    throw new Error('Development entry requires exactly one --selection=all|viewer|admin argument');
  }
  const selection = args[0].slice('--selection='.length);
  if (!Object.hasOwn(DEVELOPMENT_SELECTIONS, selection)) {
    throw new Error(`Unsupported development service selection: ${selection}`);
  }
  return selection;
}

export async function waitForDevelopmentTerminal({
  input = process.stdin,
  output = process.stdout,
  readlineFactory = (options) => readline.createInterface(options),
} = {}) {
  if (!input.isTTY) return;
  const terminal = readlineFactory({ input, output });
  try {
    await terminal.question('\nDevelopment session ended. Press Enter to close this terminal.');
  } finally {
    terminal.close();
  }
}

export async function runDevelopmentTerminalEntry({
  args = process.argv.slice(2),
  runDevelopment = runDevelopmentEnvironmentCli,
  waitForClose = waitForDevelopmentTerminal,
  logger = console,
} = {}) {
  let status = 1;
  try {
    const selection = parseDevelopmentSelection(args);
    status = await runDevelopment({ selection });
  } catch (error) {
    logger.error(error.message);
  }
  await waitForClose();
  return status;
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  process.exitCode = await runDevelopmentTerminalEntry();
}
