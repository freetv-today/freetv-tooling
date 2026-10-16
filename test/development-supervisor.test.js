import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { signalProcessTree, startDevelopmentSupervisor } from '../scripts/lib/development-supervisor.js';
import { preflightDevelopmentPorts } from '../scripts/lib/development.js';

function child(pid) {
  const value = new EventEmitter();
  value.pid = pid;
  value.exitCode = null;
  value.signalCode = null;
  return value;
}

function services() {
  return ['Viewer', 'Admin', 'PHP'].map((label, index) => ({
    label, port: 5100 + index, executable: `service-${index}`, args: ['run'], options: { stdio: 'inherit' },
  }));
}

test('successful startup launches and tracks all services after preflight', async () => {
  const launched = [];
  const session = await startDevelopmentSupervisor({
    services: services(),
    preflight: async (items) => assert.equal(items.length, 3),
    spawnProcess(executable, args, options) {
      launched.push({ executable, args, options });
      return child(100 + launched.length);
    },
  });
  assert.equal(session.records.length, 3);
  assert.deepEqual(launched.map(({ executable }) => executable), ['service-0', 'service-1', 'service-2']);
});

test('preflight failure launches no services', async () => {
  let launches = 0;
  await assert.rejects(startDevelopmentSupervisor({
    services: services(),
    preflight: async () => { throw new Error('ports unavailable'); },
    spawnProcess() { launches += 1; },
  }), /ports unavailable/);
  assert.equal(launches, 0);
});

test('duplicate configured ports are rejected before any process starts', async () => {
  const duplicated = services();
  duplicated[1].port = duplicated[0].port;
  let launches = 0;
  await assert.rejects(startDevelopmentSupervisor({
    services: duplicated, preflight: preflightDevelopmentPorts,
    spawnProcess() { launches += 1; },
  }), /Port 5100 is already in use/);
  assert.equal(launches, 0);
});

test('synchronous startup failure stops already launched services and launches no later service', async () => {
  let launches = 0;
  const signalled = [];
  const session = await startDevelopmentSupervisor({
    services: services(), preflight: async () => {},
    spawnProcess() {
      launches += 1;
      if (launches === 2) throw new Error('sync spawn failure');
      return child(200 + launches);
    },
    signalTree(target, signal) {
      signalled.push(signal);
      target.emit('exit', null, signal);
      return { requested: true };
    },
  });
  const result = await session.completion;
  assert.equal(launches, 2);
  assert.equal(result.kind, 'spawn');
  assert.deepEqual(signalled, ['SIGTERM']);
});

test('asynchronous spawn error stops siblings once despite a later exit', async () => {
  const children = services().map((_, index) => child(300 + index));
  const signals = [];
  let index = 0;
  const session = await startDevelopmentSupervisor({
    services: services(), preflight: async () => {}, spawnProcess: () => children[index++],
    signalTree(target, signal) {
      signals.push([target.pid, signal]);
      target.emit('exit', null, signal);
      return { requested: true };
    },
  });
  children[1].emit('error', new Error('async spawn failure'));
  children[1].emit('exit', 1, null);
  const result = await session.completion;
  assert.equal(result.kind, 'spawn');
  assert.equal(signals.length, 3);
});

for (const [code, signal] of [[7, null], [0, null], [null, 'SIGABRT']]) {
  test(`unexpected service exit (${code ?? signal}) stops its siblings`, async () => {
    const children = services().map((_, index) => child(400 + index));
    let index = 0;
    const session = await startDevelopmentSupervisor({
      services: services(), preflight: async () => {}, spawnProcess: () => children[index++],
      signalTree(target, stopSignal) {
        target.emit('exit', null, stopSignal);
        return { requested: true };
      },
    });
    children[0].emit('exit', code, signal);
    const result = await session.completion;
    assert.equal(result.kind, 'unexpected-exit');
    assert.equal(result.service, 'Viewer');
    assert.equal(result.exitCode, code && code !== 0 ? code : 1);
  });
}

test('graceful cancellation is idempotent and confirms every child stopped', async () => {
  const children = services().map((_, index) => child(500 + index));
  let index = 0;
  const session = await startDevelopmentSupervisor({
    services: services(), preflight: async () => {}, spawnProcess: () => children[index++],
    signalTree(target, signal) {
      target.emit('exit', null, signal);
      return { requested: true };
    },
  });
  const first = session.stop({ kind: 'cancelled', signal: 'SIGINT', exitCode: 130 });
  assert.equal(session.stop(), first);
  const result = await first;
  assert.equal(result.stopped, true);
  assert.equal(result.exitCode, 130);
});

test('shutdown forces survivors after the grace timeout', async () => {
  const target = child(600);
  const signals = [];
  const session = await startDevelopmentSupervisor({
    services: [services()[0]], preflight: async () => {}, spawnProcess: () => target,
    waitForTimeout: async () => {},
    signalTree(childProcess, signal) {
      signals.push(signal);
      if (signal === 'SIGKILL') childProcess.emit('exit', null, signal);
      return { requested: true };
    },
  });
  const result = await session.stop({ kind: 'cancelled', signal: 'SIGTERM', exitCode: 143 });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.stopped, true);
});

test('shutdown reports unresolved children after the final timeout', async () => {
  const target = child(700);
  const session = await startDevelopmentSupervisor({
    services: [services()[0]], preflight: async () => {}, spawnProcess: () => target,
    waitForTimeout: async () => {}, signalTree: () => ({ requested: false, error: 'fixture failure' }),
  });
  const result = await session.stop({ kind: 'cancelled', exitCode: 1 });
  assert.equal(result.stopped, false);
  assert.deepEqual(result.unresolved, ['Viewer']);
  assert.equal(result.signalErrors.length, 2);
});

test('process-tree signaling uses Unix groups and Windows taskkill trees', () => {
  const unix = [];
  assert.equal(signalProcessTree({ pid: 42 }, 'SIGTERM', {
    platform: 'linux', killProcessGroup: (...args) => unix.push(args),
  }).requested, true);
  assert.deepEqual(unix, [[-42, 'SIGTERM']]);

  let windows;
  assert.equal(signalProcessTree({ pid: 43 }, 'SIGKILL', {
    platform: 'win32', force: true,
    taskkill(executable, args, options) { windows = { executable, args, options }; return { status: 0 }; },
  }).requested, true);
  assert.deepEqual(windows.args, ['/PID', '43', '/T', '/F']);
});
