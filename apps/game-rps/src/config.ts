const AUTH_TOKEN =
  typeof sessionStorage !== 'undefined' && sessionStorage.getItem('kampi.authToken')
    ? sessionStorage.getItem('kampi.authToken')!
    : 'dev-guest-token-kampi-local-only';

export const runtimeConfig = {
  realtimeUrl: import.meta.env.VITE_REALTIME_PUBLIC_URL ?? 'ws://localhost:2567',
  authToken: AUTH_TOKEN,
};
