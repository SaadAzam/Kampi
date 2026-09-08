/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_PUBLIC_URL?: string;
  readonly VITE_API_PUBLIC_URL?: string;
  readonly VITE_WEB_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
