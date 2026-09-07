export type RuntimeConfig = {
  realtimeUrl: string;
  apiUrl: string;
  authToken: string;
};

let storedToken: string | null = null;
try {
  if (window.parent === window) storedToken = sessionStorage.getItem('kampi.authToken');
} catch {
  /* Storage can be unavailable in embeds. */
}

export const runtimeConfig: RuntimeConfig = {
  realtimeUrl: import.meta.env.VITE_REALTIME_PUBLIC_URL ?? 'ws://localhost:2567',
  apiUrl: import.meta.env.VITE_API_PUBLIC_URL ?? 'http://localhost:4000',
  // Prefer sessionStorage / embed bridge — no bearer token in query string for production embeds
  authToken: storedToken ?? '',
};

export function setAuthToken(token: string): void {
  runtimeConfig.authToken = token;
  try {
    if (window.parent === window) sessionStorage.setItem('kampi.authToken', token);
  } catch {
    /* In-memory session remains usable. */
  }
}
