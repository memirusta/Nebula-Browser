import type { NebulaLocale } from './locale'

const labels: Record<NebulaLocale, readonly [string, string, string, string]> = {
  tr: ['İndiriliyor ve uyumluluk deneniyor…', 'İndirildi · Yükleme testi geçti', 'İndirme veya uyumluluk testi tamamlanamadı.', 'Ayrı profilde yükleme, etkinlik ve kaldırma denendi. Eklentinin tüm işlevleri test edilmedi.'],
  en: ['Downloading and testing compatibility…', 'Downloaded · Load test passed', 'Download or compatibility test failed.', 'Loading, enablement and removal were tested in a separate profile. Full functionality was not tested.'],
  de: ['Download und Kompatibilitätstest…', 'Heruntergeladen · Ladetest bestanden', 'Download oder Kompatibilitätstest fehlgeschlagen.', 'Laden, Aktivierung und Entfernen wurden in einem separaten Profil geprüft. Nicht alle Funktionen wurden getestet.'],
  es: ['Descargando y probando compatibilidad…', 'Descargado · Prueba de carga superada', 'Falló la descarga o la prueba de compatibilidad.', 'Se probaron la carga, activación y eliminación en un perfil separado. No se probaron todas las funciones.'],
  fr: ['Téléchargement et test de compatibilité…', 'Téléchargé · Test de chargement réussi', 'Échec du téléchargement ou du test de compatibilité.', 'Le chargement, l’activation et la suppression ont été testés dans un profil distinct. Toutes les fonctions n’ont pas été testées.'],
  id: ['Mengunduh dan menguji kompatibilitas…', 'Diunduh · Uji pemuatan berhasil', 'Unduhan atau uji kompatibilitas gagal.', 'Pemuatan, aktivasi, dan penghapusan diuji di profil terpisah. Tidak semua fungsi diuji.'],
  ru: ['Скачивание и проверка совместимости…', 'Скачано · Тест загрузки пройден', 'Скачивание или проверка совместимости не удались.', 'Загрузка, включение и удаление проверены в отдельном профиле. Не все функции были проверены.'],
  it: ['Download e test di compatibilità…', 'Scaricato · Test di caricamento superato', 'Download o test di compatibilità non riuscito.', 'Caricamento, attivazione e rimozione sono stati testati in un profilo separato. Non tutte le funzioni sono state testate.'],
  ja: ['ダウンロードと互換性テスト中…', 'ダウンロード済み · 読み込みテスト成功', 'ダウンロードまたは互換性テストに失敗しました。', '別のプロファイルで読み込み、有効化、削除を確認しました。すべての機能をテストしたわけではありません。'],
}
export function extensionDownloadCheckCopy(locale: NebulaLocale) {
  const [pending, passed, failed, scope] = labels[locale]
  return { pending, passed, failed, scope }
}
