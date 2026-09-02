export type RuntimeConfig = {
  realtimeUrl: string;
  apiUrl: string;
  authToken: string;
};

const storedToken =
  typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('kampi.authToken') : null;

export const runtimeConfig: RuntimeConfig = {
  realtimeUrl: import.meta.env.VITE_REALTIME_PUBLIC_URL ?? 'ws://localhost:2567',
  apiUrl: import.meta.env.VITE_API_PUBLIC_URL ?? 'http://localhost:4000',
  // Prefer sessionStorage / embed bridge — no bearer token in query string for production embeds
  authToken: storedToken ?? '',
};

export function setAuthToken(token: string): void {
  runtimeConfig.authToken = token;
  sessionStorage.setItem('kampi.authToken', token);
}
