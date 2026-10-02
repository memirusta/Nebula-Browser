import type { NebulaLocale } from './locale'

interface DownloadCopy {
  download: string
  downloading: string
  saved: string
  failed: string
  desktop: string
}

export const EXTENSION_DOWNLOAD_COPY: Record<NebulaLocale, DownloadCopy> = {
  tr: { download: 'İndir', downloading: 'İndiriliyor…', saved: 'İndirildi', failed: 'İndirme tamamlanamadı. Tekrar deneyebilirsin.', desktop: 'İndirmek için Nebula masaüstü uygulamasını kullan.' },
  en: { download: 'Download', downloading: 'Downloading…', saved: 'Downloaded', failed: 'Download failed. Please try again.', desktop: 'Use the Nebula desktop app to download.' },
  de: { download: 'Herunterladen', downloading: 'Wird heruntergeladen…', saved: 'Heruntergeladen', failed: 'Download fehlgeschlagen. Bitte erneut versuchen.', desktop: 'Zum Herunterladen die Nebula-Desktop-App verwenden.' },
  es: { download: 'Descargar', downloading: 'Descargando…', saved: 'Descargado', failed: 'No se pudo descargar. Inténtalo de nuevo.', desktop: 'Usa la aplicación de escritorio de Nebula para descargar.' },
  fr: { download: 'Télécharger', downloading: 'Téléchargement…', saved: 'Téléchargé', failed: 'Échec du téléchargement. Réessayez.', desktop: 'Utilisez l’application de bureau Nebula pour télécharger.' },
  id: { download: 'Unduh', downloading: 'Mengunduh…', saved: 'Diunduh', failed: 'Unduhan gagal. Silakan coba lagi.', desktop: 'Gunakan aplikasi desktop Nebula untuk mengunduh.' },
  ru: { download: 'Скачать', downloading: 'Скачивание…', saved: 'Скачано', failed: 'Не удалось скачать. Попробуйте ещё раз.', desktop: 'Для скачивания используйте приложение Nebula для компьютера.' },
  it: { download: 'Scarica', downloading: 'Download…', saved: 'Scaricato', failed: 'Download non riuscito. Riprova.', desktop: 'Usa l’app desktop Nebula per scaricare.' },
  ja: { download: 'ダウンロード', downloading: 'ダウンロード中…', saved: 'ダウンロード済み', failed: 'ダウンロードできませんでした。もう一度お試しください。', desktop: 'ダウンロードにはNebulaデスクトップアプリを使用してください。' },
}
