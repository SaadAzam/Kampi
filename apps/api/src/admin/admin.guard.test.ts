import { describe, expect, it } from 'vitest';
import { isAdmin, AdminGuard } from './admin.guard.js';
import type { ExecutionContext } from '@nestjs/common';
const user = { id: 'allowed', displayName: 'Admin', email: 'admin@kampi.local', isGuest: false };
describe('admin authorization', () => {
  it('fails closed without an explicit account ID', () => {
    expect(isAdmin(user, '')).toBe(false);
  });
  it('rejects guests, missing identities and email spoofing', () => {
    expect(isAdmin({ ...user, isGuest: true }, 'allowed')).toBe(false);
    expect(isAdmin(undefined, 'allowed')).toBe(false);
    expect(isAdmin({ ...user, id: 'attacker' }, 'allowed')).toBe(false);
  });
  it('matches exact user IDs and not substrings', () => {
    expect(isAdmin(user, 'other, allowed')).toBe(true);
    expect(isAdmin(user, 'prefix-allowed')).toBe(false);
  });
  it('rejects an unauthenticated request at the API boundary', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;
    expect(() => new AdminGuard().canActivate(context)).toThrow('Administrator access required');
  });
});
