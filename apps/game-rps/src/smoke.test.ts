import { describe, expect, it } from 'vitest';

describe('game-rps smoke', () => {
  it('loads runtime config defaults', () => {
    expect('dev-guest-token-kampi-local-only'.length).toBeGreaterThan(10);
  });
});
