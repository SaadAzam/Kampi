import test from 'node:test';
import assert from 'node:assert/strict';
import { deployService, isSnapshotFailure } from './deploy-railway.mjs';

const id = '681b0a0b-868d-4fcd-9f2c-443f6ea18157';
const otherId = 'f1a2b004-1e19-49c0-bdde-4c58500c6817';
const snapshot = {
  id,
  status: 'FAILED',
  meta: {
    configErrors: [
      'Failed to create code snapshot. Please review your last commit, or try again.',
      'If this error persists, please reach out to the Railway team.',
    ],
  },
};
const result = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const missingBuild = {
  code: 1,
  stdout: '',
  stderr: 'Deployment does not have an associated build\n',
};
function mock(steps, timeoutMs = 120_000) {
  let time = 0;
  const calls = [];
  return {
    calls,
    options: {
      timeoutMs,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      log: () => {},
      run: async (args) => {
        calls.push(args);
        assert.ok(steps.length, `Unexpected command: ${args.join(' ')}`);
        const [command, response] = steps.shift();
        assert.equal(args[0], command);
        return response;
      },
    },
  };
}

test('waits for the exact uploaded ID, ignoring another successful deployment', async () => {
  const m = mock([
    ['up', result({ deploymentId: id })],
    [
      'deployment',
      result([
        { id: otherId, status: 'SUCCESS' },
        { id, status: 'BUILDING' },
      ]),
    ],
    ['deployment', result([{ id, status: 'SUCCESS' }])],
  ]);
  assert.equal(await deployService('api', m.options), id);
  assert.equal(m.calls.filter((args) => args[0] === 'deployment').length, 2);
});

test('retries only the confirmed snapshot failure without an associated build', async () => {
  const m = mock([
    ['up', result({ deploymentId: id })],
    ['deployment', result([snapshot])],
    ['logs', missingBuild],
    ['up', result({ deploymentId: otherId })],
    ['deployment', result([{ id: otherId, status: 'SUCCESS' }])],
  ]);
  assert.equal(await deployService('api', m.options), otherId);
  assert.ok(m.calls[2].includes(id));
  assert.equal(m.calls.filter((args) => args[0] === 'up').length, 2);
});

for (const [label, status, logs] of [
  ['compiler failure', { id, status: 'FAILED', meta: {} }, null],
  ['runtime crash', { id, status: 'CRASHED', meta: snapshot.meta }, null],
  ['snapshot label with a real build', snapshot, { code: 0, stdout: 'Build failed', stderr: '' }],
  ['unverifiable build status', snapshot, { code: 1, stdout: '', stderr: 'Network timeout' }],
])
  test(`never retries ${label}`, async () => {
    const m = mock([
      ['up', result({ deploymentId: id })],
      ['deployment', result([status])],
      ...(logs ? [['logs', logs]] : []),
    ]);
    await assert.rejects(deployService('api', m.options), /No retry/);
    assert.equal(m.calls.filter((args) => args[0] === 'up').length, 1);
  });

test('never retries after observing the build lifecycle', async () => {
  const m = mock([
    ['up', result({ deploymentId: id })],
    ['deployment', result([{ id, status: 'BUILDING' }])],
    ['deployment', result([snapshot])],
  ]);
  await assert.rejects(deployService('api', m.options), /No retry/);
  assert.equal(m.calls.length, 3);
});

test('caps uploads at one original plus two confirmed snapshot retries', async () => {
  const steps = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    steps.push(['up', result({ deploymentId: id })], ['deployment', result([snapshot])]);
    if (attempt < 2) steps.push(['logs', missingBuild]);
  }
  const m = mock(steps, 180_000);
  await assert.rejects(deployService('api', m.options), /No retry/);
  assert.equal(m.calls.filter((args) => args[0] === 'up').length, 3);
});

for (const output of [
  { code: 1, stdout: '', stderr: 'Upload timed out' },
  { code: 0, stdout: 'Unexpected output', stderr: '' },
  result({ queued: true }),
])
  test('stops an ambiguous upload instead of duplicating it', async () => {
    const m = mock([['up', output]]);
    await assert.rejects(deployService('api', m.options), /no (?:upload )?retry/i);
    assert.equal(m.calls.length, 1);
  });

test('missing uploaded ID times out instead of trusting the newest deployment', async () => {
  const m = mock(
    [
      ['up', result({ deploymentId: id })],
      ['deployment', result([{ id: otherId, status: 'SUCCESS' }])],
    ],
    1,
  );
  await assert.rejects(deployService('api', m.options), /deadline/);
  assert.equal(m.calls.filter((args) => args[0] === 'up').length, 1);
});

test('mixed and unknown configuration errors are not retryable snapshot failures', () => {
  assert.equal(isSnapshotFailure(snapshot), true);
  assert.equal(
    isSnapshotFailure({
      ...snapshot,
      meta: { configErrors: [...snapshot.meta.configErrors, 'Dockerfile missing'] },
    }),
    false,
  );
  assert.equal(isSnapshotFailure({ id, status: 'FAILED' }), false);
});

test('a status-read failure never starts another deployment', async () => {
  const m = mock([
    ['up', result({ deploymentId: id })],
    ['deployment', { code: 1, stdout: '', stderr: 'API unavailable' }],
  ]);
  await assert.rejects(deployService('api', m.options), /status failed; no upload retry/);
  assert.equal(m.calls.filter((args) => args[0] === 'up').length, 1);
});
