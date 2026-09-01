import { describe, expect, it } from 'vitest';

describe('admin shell', () => {
  it('has placeholder routes defined', () => {
    expect(['/players', '/matches', '/wallet']).toHaveLength(3);
  });
});
