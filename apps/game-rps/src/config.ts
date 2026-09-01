const REALTIME_URL = import.meta.env.VITE_REALTIME_PUBLIC_URL ?? 'ws://localhost:2567';
const AUTH_TOKEN =
  new URLSearchParams(window.location.search).get('token') ??
  'dev-guest-token-kampi-local-only';

export const runtimeConfig = {
  realtimeUrl: REALTIME_URL,
  authToken: AUTH_TOKEN,
};
