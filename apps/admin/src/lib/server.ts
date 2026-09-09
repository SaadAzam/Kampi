import { cookies } from 'next/headers';
export const cookieName =
  process.env.NODE_ENV === 'production' ? '__Host-kampi-admin' : 'kampi-admin';
export const apiUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
export async function adminToken() {
  return (await cookies()).get(cookieName)?.value;
}
export function validOrigin(request: Request) {
  const expected = process.env.ADMIN_PUBLIC_URL ?? new URL(request.url).origin;
  return request.headers.get('origin') === new URL(expected).origin;
}
export function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
