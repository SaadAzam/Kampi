import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '@kampi/contracts';

describe('isAllowedOrigin', () => {
  it('allows exact origin matches', () => {
    expect(isAllowedOrigin('http://localhost:3000', ['http://localhost:3000'])).toBe(true);
    expect(isAllowedOrigin('http://evil.com', ['http://localhost:3000'])).toBe(false);
  });

  it('allows wildcard when configured', () => {
    expect(isAllowedOrigin('http://any.com', ['*'])).toBe(true);
  });
});
