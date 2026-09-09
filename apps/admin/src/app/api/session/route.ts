import { cookies } from 'next/headers';
import { apiUrl, cookieName, adminToken, validOrigin, response } from '../../../lib/server';
export async function POST(request: Request) {
  if (!validOrigin(request)) return response({ message: 'Invalid request origin' }, 403);
  const raw = await request.text();
  if (raw.length > 4096) return response({ message: 'Request too large' }, 413);
  try {
    const body = JSON.parse(raw) as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string')
      return response({ message: 'Email and password are required' }, 400);
    const login = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (!login.ok)
      return response(
        {
          message:
            login.status === 429
              ? 'Too many attempts. Try again later.'
              : 'Invalid administrator credentials',
        },
        login.status === 429 ? 429 : 401,
      );
    const session = (await login.json()) as { token: string };
    const authorized = await fetch(`${apiUrl}/admin/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!authorized.ok) {
      await fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
      return response({ message: 'Administrator access is not enabled for this account' }, 403);
    }
    (await cookies()).set(cookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 3600,
    });
    return response({ ok: true });
  } catch {
    return response({ message: 'Could not sign in. Please try again.' }, 503);
  }
}
export async function DELETE(request: Request) {
  if (!validOrigin(request)) return response({ message: 'Invalid request origin' }, 403);
  const token = await adminToken();
  if (token)
    await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  (await cookies()).delete(cookieName);
  return response({ ok: true });
}
