import { adminToken, apiUrl, validOrigin, response } from '../../../../lib/server';
type Context = { params: Promise<{ path: string[] }> };
async function proxy(request: Request, context: Context) {
  if (request.method !== 'GET' && !validOrigin(request))
    return response({ message: 'Invalid request origin' }, 403);
  const token = await adminToken();
  if (!token) return response({ message: 'Sign in to continue' }, 401);
  const path = (await context.params).path.join('/');
  const read = /^(me|overview|players|matches|wallet|games|audit|health|matches\/[a-f0-9-]{36})$/;
  const write = /^(players\/[a-f0-9-]{36}\/(status|adjustment)|games\/[a-f0-9-]{36}\/status)$/;
  if (!(request.method === 'GET' ? read : write).test(path))
    return response({ message: 'Not found' }, 404);
  const body = request.method === 'GET' ? undefined : await request.text();
  if (body && body.length > 8192) return response({ message: 'Request too large' }, 413);
  try {
    const upstream = await fetch(`${apiUrl}/admin/${path}${new URL(request.url).search}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return response({ message: 'The API is temporarily unavailable. Retry shortly.' }, 503);
  }
}
export const GET = proxy;
export const POST = proxy;
