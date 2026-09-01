/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
