import { describe, expect, it } from 'vitest';
import { LoginRequestSchema, RegisterRequestSchema } from './auth.js';
import { LeaderboardQuerySchema } from './stats.js';

describe('auth contracts', () => {
  it('normalizes email and requires a password', () => {
    const parsed = RegisterRequestSchema.parse({
      email: '  You@Kampi.FUN ',
      password: 'password123',
      displayName: 'You',
    });
    expect(parsed.email).toBe('you@kampi.fun');
    expect(LoginRequestSchema.safeParse({ email: 'bad', password: 'x' }).success).toBe(false);
  });
});

describe('stats contracts', () => {
  it('defaults weekly leaderboard queries', () => {
    expect(LeaderboardQuerySchema.parse({})).toEqual({
      period: 'weekly',
      limit: 20,
    });
  });
});
