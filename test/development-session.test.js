import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runDevelopmentSession } from '../cli/development-session.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, reject, resolve };
}

function presentation() {
  const messages = [];
  return {
    messages,
    note: (message) => messages.push(['note', message]),
    info: (message) => messages.push(['info', message]),
    success: (message) => messages.push(['success', message]),
    error: (message) => messages.push(['error', message]),
  };
}

function controlledSession({ stopResult } = {}) {
  const completion = deferred();
  const reasons = [];
  return {
    completion,
    reasons,
    session: {
      completion: completion.promise,
      stop(reason) {
        reasons.push(reason);
        if (stopResult) completion.resolve(stopResult);
        return completion.promise;
      },
    },
  };
}

function terminalInput({ raw = false } = {}) {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = raw;
  input.rawModes = [];
  input.setRawMode = (enabled) => {
    input.isRaw = enabled;
    input.rawModes.push(enabled);
  };
  return input;
}

test('TTY Ctrl+C remains owned by the CLI and restores terminal input before menu return', async () => {
  const signals = new EventEmitter();
  const input = terminalInput();
  const result = {
    kind: 'cancelled', signal: 'SIGINT', stopped: true, unresolved: [], signalErrors: [], exitCode: 130,
  };
  const controlled = controlledSession({ stopResult: result });
  const running = runDevelopmentSession({
    startEnvironment: async () => controlled.session,
    signalSource: signals,
    inputSource: input,
    presentation: presentation(),
  });
  await Promise.resolve();

  input.emit('data', Buffer.from([3]));
  const outcome = await running;

  assert.equal(outcome.returnToMenu, true);
  assert.equal(controlled.reasons.length, 1);
  assert.equal(controlled.reasons[0].signal, 'SIGINT');
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('development input ownership restores an existing raw-mode state', async () => {
  const input = terminalInput({ raw: true });
  const result = {
    kind: 'cancelled', signal: 'SIGINT', stopped: true, unresolved: [], signalErrors: [], exitCode: 130,
  };
  const outcome = await runDevelopmentSession({
    startEnvironment: async () => ({ completion: Promise.resolve(result), stop: async () => result }),
    signalSource: new EventEmitter(),
    inputSource: input,
    presentation: presentation(),
  });

  assert.equal(outcome.returnToMenu, true);
  assert.deepEqual(input.rawModes, []);
  assert.equal(input.isRaw, true);
  assert.equal(input.listenerCount('data'), 0);
});

test('Ctrl+C requests one supervised shutdown, awaits completion, and removes scoped listeners', async () => {
  const signals = new EventEmitter();
  const controlled = controlledSession();
  const output = presentation();
  const running = runDevelopmentSession({
    startEnvironment: async () => controlled.session, signalSource: signals, presentation: output,
  });
  await Promise.resolve();
  signals.emit('SIGINT');
  signals.emit('SIGINT');
  assert.equal(controlled.reasons.length, 1);

  let settled = false;
  void running.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  controlled.completion.resolve({
    kind: 'cancelled', signal: 'SIGINT', stopped: true, unresolved: [], signalErrors: [], exitCode: 130,
  });
  const outcome = await running;
  assert.equal(outcome.status, 0);
  assert.equal(outcome.returnToMenu, true);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('cancellation during startup is retained until the supervisor session is available', async () => {
  const signals = new EventEmitter();
  const startup = deferred();
  const result = {
    kind: 'cancelled', signal: 'SIGINT', stopped: true, unresolved: [], signalErrors: [], exitCode: 130,
  };
  const controlled = controlledSession({ stopResult: result });
  const running = runDevelopmentSession({
    startEnvironment: () => startup.promise, signalSource: signals, presentation: presentation(),
  });
  signals.emit('SIGINT');
  startup.resolve(controlled.session);
  assert.equal((await running).status, 0);
  assert.equal(controlled.reasons.length, 1);
  assert.equal(controlled.reasons[0].signal, 'SIGINT');
});

test('SIGTERM performs controlled shutdown and requests CLI termination after completion', async () => {
  const signals = new EventEmitter();
  const result = {
    kind: 'cancelled', signal: 'SIGTERM', stopped: true, unresolved: [], signalErrors: [], exitCode: 143,
  };
  const controlled = controlledSession({ stopResult: result });
  const running = runDevelopmentSession({
    startEnvironment: async () => controlled.session, signalSource: signals, presentation: presentation(),
  });
  await Promise.resolve();
  signals.emit('SIGTERM');
  const outcome = await running;
  assert.equal(outcome.status, 0);
  assert.equal(outcome.returnToMenu, false);
  assert.equal(controlled.reasons.length, 1);
});

test('unexpected service exit is a failure but permits menu return after confirmed shutdown', async () => {
  const signals = new EventEmitter();
  const output = presentation();
  const result = {
    kind: 'unexpected-exit', service: 'Viewer', code: 7,
    stopped: true, unresolved: [], signalErrors: [], exitCode: 7,
  };
  const outcome = await runDevelopmentSession({
    startEnvironment: async () => ({ completion: Promise.resolve(result), stop: async () => result }),
    signalSource: signals,
    presentation: output,
  });
  assert.equal(outcome.status, 1);
  assert.equal(outcome.returnToMenu, true);
  assert.match(output.messages.find(([kind]) => kind === 'error')[1], /stopped unexpectedly.*Viewer.*7/u);
});

test('incomplete shutdown reports unresolved services and signaling errors without menu return', async () => {
  const signals = new EventEmitter();
  const output = presentation();
  const result = {
    kind: 'cancelled', stopped: false, unresolved: ['Admin', 'PHP'],
    signalErrors: ['Admin: SIGTERM failed'], exitCode: 1,
  };
  const outcome = await runDevelopmentSession({
    startEnvironment: async () => ({ completion: Promise.resolve(result), stop: async () => result }),
    signalSource: signals,
    presentation: output,
  });
  assert.equal(outcome.status, 1);
  assert.equal(outcome.returnToMenu, false);
  assert.match(output.messages.map(([, message]) => message).join('\n'), /Admin, PHP.*SIGTERM failed/su);
});

test('startup failure is reported and scoped signal listeners are still removed', async () => {
  const signals = new EventEmitter();
  const output = presentation();
  const outcome = await runDevelopmentSession({
    startEnvironment: async () => { throw new Error('port fixture'); },
    signalSource: signals,
    presentation: output,
  });
  assert.equal(outcome.status, 1);
  assert.equal(outcome.returnToMenu, true);
  assert.match(output.messages.find(([kind]) => kind === 'error')[1], /failed to start: port fixture/u);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('SIGTERM during startup preserves the startup failure and exits after listener cleanup', async () => {
  const signals = new EventEmitter();
  const startup = deferred();
  const output = presentation();
  const running = runDevelopmentSession({
    startEnvironment: () => startup.promise, signalSource: signals, presentation: output,
  });

  signals.emit('SIGTERM');
  signals.emit('SIGTERM');
  startup.reject(new Error('startup rejection fixture'));
  const outcome = await running;

  assert.equal(outcome.status, 1);
  assert.equal(outcome.returnToMenu, false);
  assert.match(output.messages.find(([kind]) => kind === 'error')[1], /startup rejection fixture/u);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('SIGTERM racing an unexpected exit preserves the supervisor failure and exits once cleanup completes', async () => {
  const signals = new EventEmitter();
  const controlled = controlledSession();
  const output = presentation();
  const running = runDevelopmentSession({
    startEnvironment: async () => controlled.session, signalSource: signals, presentation: output,
  });
  await Promise.resolve();

  const failure = {
    kind: 'unexpected-exit', service: 'Admin', code: 9,
    stopped: true, unresolved: [], signalErrors: [], exitCode: 9,
  };
  controlled.completion.resolve(failure);
  signals.emit('SIGTERM');
  signals.emit('SIGTERM');
  const outcome = await running;

  assert.equal(outcome.status, 1);
  assert.equal(outcome.returnToMenu, false);
  assert.equal(outcome.result, failure);
  assert.equal(controlled.reasons.length, 1);
  assert.equal(controlled.reasons[0].signal, 'SIGTERM');
  assert.match(output.messages.find(([kind]) => kind === 'error')[1], /stopped unexpectedly.*Admin.*9/u);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('SIGINT during startup retains menu return and makes only one shutdown request', async () => {
  const signals = new EventEmitter();
  const startup = deferred();
  const result = {
    kind: 'cancelled', signal: 'SIGINT', stopped: true, unresolved: [], signalErrors: [], exitCode: 130,
  };
  const controlled = controlledSession({ stopResult: result });
  const running = runDevelopmentSession({
    startEnvironment: () => startup.promise, signalSource: signals, presentation: presentation(),
  });

  signals.emit('SIGINT');
  signals.emit('SIGINT');
  startup.resolve(controlled.session);
  const outcome = await running;

  assert.equal(outcome.status, 0);
  assert.equal(outcome.returnToMenu, true);
  assert.equal(controlled.reasons.length, 1);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
