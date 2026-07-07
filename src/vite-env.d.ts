/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_GOOGLE_REDIRECT_URI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
