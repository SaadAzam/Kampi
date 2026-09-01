import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { RealtimeEnvSchema, getEconomyFromEnv, parseEnv } from '@kampi/contracts';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv();

export const env = parseEnv(RealtimeEnvSchema);
export const economy = getEconomyFromEnv(env);

export const ROUND_TIMEOUT_MS = 15_000;
export const BEST_OF = 3;
