import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runCommand } from '../scripts/lib/command-runner.js';

function controlledSpawn() {
  const child = new EventEmitter();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  let invocation;
  return {
    child,
    spawnProcess(executable, args, options) {
      invocation = { executable, args, options };
      return child;
    },
    invocation: () => invocation,
  };
}

test('finite command success returns structured result and forwards invocation options', async () => {
  const controlled = controlledSpawn();
  const environment = { FIXTURE: 'preserved' };
  const promise = runCommand({
    executable: 'fixture-command', args: ['one', 'two'], cwd: '/fixture',
    env: environment, stdio: 'inherit', spawnProcess: controlled.spawnProcess,
  });
  controlled.child.emit('close', 0, null);
  assert.deepEqual(await promise, {
    kind: 'success', executable: 'fixture-command', args: ['one', 'two'], cwd: '/fixture',
    exitCode: 0, signal: null,
  });
  assert.deepEqual(controlled.invocation(), {
    executable: 'fixture-command',
    args: ['one', 'two'],
    options: { cwd: '/fixture', env: environment, stdio: 'inherit' },
  });
});

test('nonzero completion preserves the child exit code', async () => {
  const controlled = controlledSpawn();
  const promise = runCommand({ executable: 'fixture', spawnProcess: controlled.spawnProcess });
  controlled.child.emit('close', 7, null);
  await assert.rejects(promise, (error) => error.kind === 'exit' && error.exitCode === 7);
});

test('signal termination is distinct from a normal exit', async () => {
  const controlled = controlledSpawn();
  const promise = runCommand({ executable: 'fixture', spawnProcess: controlled.spawnProcess });
  controlled.child.emit('close', null, 'SIGTERM');
  await assert.rejects(promise, (error) => error.kind === 'signal' && error.signal === 'SIGTERM');
});

test('asynchronous spawn errors are handled and reported', async () => {
  const controlled = controlledSpawn();
  const promise = runCommand({ executable: 'missing', spawnProcess: controlled.spawnProcess });
  controlled.child.emit('error', new Error('ENOENT fixture'));
  await assert.rejects(promise, (error) => error.kind === 'spawn' && /ENOENT fixture/.test(error.message));
});

test('synchronous spawn throws are reported as launch failures', async () => {
  await assert.rejects(
    runCommand({ executable: 'missing', spawnProcess() { throw new Error('synchronous fixture'); } }),
    (error) => error.kind === 'spawn' && /synchronous fixture/.test(error.message),
  );
});

test('error followed by close settles exactly once without an unhandled error', async () => {
  const controlled = controlledSpawn();
  const promise = runCommand({ executable: 'fixture', spawnProcess: controlled.spawnProcess });
  controlled.child.emit('error', new Error('first failure'));
  controlled.child.emit('error', new Error('late duplicate failure'));
  controlled.child.emit('close', 0, null);
  await assert.rejects(promise, (error) => error.kind === 'spawn' && /first failure/.test(error.message));
});

test('cancellation before launch does not spawn a process', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawned = false;
  await assert.rejects(
    runCommand({
      executable: 'fixture', signal: controller.signal,
      spawnProcess() { spawned = true; },
    }),
    (error) => error.kind === 'cancelled',
  );
  assert.equal(spawned, false);
});

test('cancellation during execution requests termination and waits for child close', async () => {
  const controlled = controlledSpawn();
  const controller = new AbortController();
  const promise = runCommand({
    executable: 'fixture', signal: controller.signal, spawnProcess: controlled.spawnProcess,
  });
  controller.abort();
  assert.deepEqual(controlled.child.killCalls, ['SIGTERM']);
  controlled.child.emit('close', null, 'SIGTERM');
  await assert.rejects(promise, (error) => error.kind === 'cancelled' && error.signal === 'SIGTERM');
});
