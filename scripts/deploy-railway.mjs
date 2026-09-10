import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const project = '74c72010-d4cf-412f-a1df-07a2dc05ec4d';
const environment = '836d08e4-332b-47f5-9d0f-8f4b647e758a';
const snapshotError =
  'Failed to create code snapshot. Please review your last commit, or try again.';
const supportMessage = 'If this error persists, please reach out to the Railway team.';
const noBuild = 'Deployment does not have an associated build';
const pending = new Set(['INITIALIZING', 'QUEUED', 'WAITING', 'BUILDING', 'DEPLOYING']);

async function runCli(args) {
  try {
    return {
      code: 0,
      ...(await execute('railway', args, {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1', RAILWAY_NO_AUTO_UPDATE: '1' },
      })),
    };
  } catch (error) {
    return {
      code: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr || error.message,
    };
  }
}

function jsonResult(result, operation) {
  if (result.code !== 0) {
    throw new Error(`${operation} failed; no upload retry: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${operation} returned unknown output; no upload retry.`);
  }
}

export function isSnapshotFailure(deployment) {
  const errors = deployment.meta?.configErrors;
  return (
    deployment.status === 'FAILED' &&
    Array.isArray(errors) &&
    errors.includes(snapshotError) &&
    errors.every((error) => error === snapshotError || error === supportMessage)
  );
}

export async function deployService(
  service,
  {
    run = runCli,
    sleep = delay,
    now = Date.now,
    log = console.log,
    timeoutMs = 15 * 60_000,
    message = 'manual deployment',
  } = {},
) {
  const target = ['--service', service, '--project', project, '--environment', environment];
  const deadline = now() + timeoutMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const upload = jsonResult(
      await run([
        'up',
        ...target,
        '--detach',
        '--json',
        '--message',
        `${message}; upload ${attempt + 1}`,
      ]),
      `${service} upload`,
    );
    const id = upload?.deploymentId;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`${service}: upload has no valid deployment ID; outcome unknown, no retry.`);
    }
    log(`${service}: watching deployment ${id}`);
    let built = false;
    let previousStatus;
    let retry = false;
    while (now() < deadline) {
      const list = jsonResult(
        await run(['deployment', 'list', ...target, '--limit', '100', '--json']),
        `${service} status`,
      );
      if (!Array.isArray(list)) throw new Error(`${service}: unknown deployment list; no retry.`);
      const deployment = list.find((item) => item.id === id);
      if (deployment) {
        const status = deployment.status;
        if (status !== previousStatus) log(`${service}: ${id} ${status}`);
        previousStatus = status;
        if (status === 'SUCCESS') return id;
        if (status === 'BUILDING' || status === 'DEPLOYING') built = true;
        if (!pending.has(status)) {
          // Exact ID + explicit snapshot diagnosis + no associated build are all
          // required. Never repeat an ambiguous upload or a real build failure.
          if (!built && isSnapshotFailure(deployment) && attempt < 2) {
            const logs = await run(['logs', '--build', id, ...target, '--lines', '1']);
            retry = logs.code !== 0 && `${logs.stdout}\n${logs.stderr}`.trim() === noBuild;
          }
          if (!retry) {
            throw new Error(
              `${service}: deployment ${id} ended ${status}. ${JSON.stringify(deployment.meta?.configErrors ?? [])} No retry.`,
            );
          }
          break;
        }
      }
      await sleep(10_000);
    }
    if (!retry || now() + 30_000 * (attempt + 1) >= deadline) {
      throw new Error(
        `${service}: deployment ${id} exceeded its deadline; inspect it before retrying.`,
      );
    }
    log(`${service}: confirmed snapshot failure without a build; retry ${attempt + 1}/2.`);
    await sleep(30_000 * (attempt + 1));
  }
}

async function main() {
  if (!process.env.RAILWAY_API_TOKEN)
    throw new Error('Missing GitHub repository secret RAILWAY_TOKEN.');
  const message = `github ${(process.env.GITHUB_SHA ?? 'manual').slice(0, 7)} run ${process.env.GITHUB_RUN_ID ?? 'manual'}`;
  for (const service of ['api', 'realtime', 'web', 'admin', 'game-rps', 'game-penalty']) {
    await deployService(service, { message });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
