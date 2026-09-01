import { z } from 'zod';
import { EconomyConfigSchema } from './common.js';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  REDIS_URL: z.string().url().or(z.string().startsWith('redis://')),
  JWT_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  API_PUBLIC_URL: z.string().url(),
  REALTIME_PUBLIC_URL: z.string(),
  GAME_RPS_PUBLIC_URL: z.string().url(),
});

export const ApiEnvSchema = baseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(4000),
  ADMIN_ORIGIN: z.string().url().optional(),
  DEV_GUEST_AUTH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  STARTING_CHIPS: z.coerce.bigint().default(10000n),
  RPS_ENTRY_FEE: z.coerce.bigint().default(500n),
  RPS_WINNER_PAYOUT: z.coerce.bigint().default(950n),
  BOT_FILL_AFTER_MS: z.coerce.number().int().positive().default(10_000),
  RECONNECT_GRACE_MS: z.coerce.number().int().positive().default(30_000),
});

export const RealtimeEnvSchema = baseEnvSchema.extend({
  REALTIME_PORT: z.coerce.number().int().positive().default(2567),
  STARTING_CHIPS: z.coerce.bigint().default(10000n),
  RPS_ENTRY_FEE: z.coerce.bigint().default(500n),
  RPS_WINNER_PAYOUT: z.coerce.bigint().default(950n),
  BOT_FILL_AFTER_MS: z.coerce.number().int().positive().default(10_000),
  RECONNECT_GRACE_MS: z.coerce.number().int().positive().default(30_000),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;
export type RealtimeEnv = z.infer<typeof RealtimeEnvSchema>;

export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}

export function getEconomyFromEnv(env: {
  STARTING_CHIPS?: bigint;
  RPS_ENTRY_FEE?: bigint;
  RPS_WINNER_PAYOUT?: bigint;
  BOT_FILL_AFTER_MS?: number;
  RECONNECT_GRACE_MS?: number;
}) {
  return EconomyConfigSchema.parse({
    startingChips: env.STARTING_CHIPS,
    rpsEntryFee: env.RPS_ENTRY_FEE,
    rpsWinnerPayout: env.RPS_WINNER_PAYOUT,
    botFillAfterMs: env.BOT_FILL_AFTER_MS,
    reconnectGraceMs: env.RECONNECT_GRACE_MS,
  });
}
