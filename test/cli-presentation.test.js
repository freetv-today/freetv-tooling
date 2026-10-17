import assert from 'node:assert/strict';
import test from 'node:test';
import { createResultPresentation, styleResultMessage } from '../cli/presentation.js';

const ANSI_GREEN = '\u001b[32m';
const ANSI_RED = '\u001b[31m';
const ANSI_RESET = '\u001b[39m';

test('operation results use green success and red failure text when color is enabled', () => {
  assert.equal(
    styleResultMessage('green', 'Operation completed.', {
      environment: { FORCE_COLOR: '1' }, stream: { isTTY: false },
    }),
    `${ANSI_GREEN}Operation completed.${ANSI_RESET}`,
  );
  assert.equal(
    styleResultMessage('red', 'Operation failed.', {
      environment: { FORCE_COLOR: '1' }, stream: { isTTY: false },
    }),
    `${ANSI_RED}Operation failed.${ANSI_RESET}`,
  );
});

test('operation results remain readable plain text when color is disabled or unsupported', () => {
  for (const options of [
    { environment: { NO_COLOR: '1' }, stream: { isTTY: true } },
    { environment: { FORCE_COLOR: '0' }, stream: { isTTY: true } },
    { environment: { TERM: 'dumb' }, stream: { isTTY: true } },
    { environment: {}, stream: { isTTY: false } },
  ]) {
    assert.equal(styleResultMessage('green', 'Readable result.', options), 'Readable result.');
  }
});

test('result presentation preserves Clack log methods and leaves neutral messages alone', () => {
  const events = [];
  const prompts = {
    log: {
      success: (message) => events.push(['success', message]),
      error: (message) => events.push(['error', message]),
      info: (message) => events.push(['info', message]),
    },
  };
  const presentation = createResultPresentation(prompts, {
    environment: { FORCE_COLOR: '1' }, stream: { isTTY: false },
  });

  presentation.success('Succeeded.');
  presentation.error('Failed.');
  prompts.log.info('Cancelled.');

  assert.deepEqual(events, [
    ['success', `${ANSI_GREEN}Succeeded.${ANSI_RESET}`],
    ['error', `${ANSI_RED}Failed.${ANSI_RESET}`],
    ['info', 'Cancelled.'],
  ]);
});
