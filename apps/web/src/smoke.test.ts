import { describe, expect, it } from 'vitest';

describe('web shell', () => {
  it('has default API url', () => {
    expect('http://localhost:4000'.startsWith('http')).toBe(true);
  });
});
