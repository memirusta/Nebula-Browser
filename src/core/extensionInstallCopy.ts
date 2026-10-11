import type { NebulaLocale } from './locale'

// install, installing, installed, remove, removing, checking, failure, enable, access, reload
const messages: Record<NebulaLocale, readonly [string, string, string, string, string, string, string, string, string, string]> = {
  tr: ['Kur', 'Kuruluyor…', 'Kurulu', 'Kaldır', 'Kaldırılıyor…', 'Kontrol ediliyor…', 'İşlem tamamlanamadı. Tekrar deneyebilirsin.', 'Etkinleştir', 'Site erişimi', 'Etkilenen açık sekmeleri yenile.'],
  en: ['Install', 'Installing…', 'Installed', 'Remove', 'Removing…', 'Checking…', 'The operation failed. Please try again.', 'Enable', 'Website access', 'Reload affected open tabs.'],
  de: ['Installieren', 'Wird installiert…', 'Installiert', 'Entfernen', 'Wird entfernt…', 'Wird geprüft…', 'Der Vorgang ist fehlgeschlagen. Bitte erneut versuchen.', 'Aktivieren', 'Website-Zugriff', 'Betroffene offene Tabs neu laden.'],
  es: ['Instalar', 'Instalando…', 'Instalado', 'Eliminar', 'Eliminando…', 'Comprobando…', 'La operación falló. Inténtalo de nuevo.', 'Activar', 'Acceso a sitios', 'Recarga las pestañas abiertas afectadas.'],
  fr: ['Installer', 'Installation…', 'Installé', 'Supprimer', 'Suppression…', 'Vérification…', 'L’opération a échoué. Réessayez.', 'Activer', 'Accès aux sites', 'Rechargez les onglets concernés.'],
  id: ['Pasang', 'Memasang…', 'Terpasang', 'Hapus', 'Menghapus…', 'Memeriksa…', 'Operasi gagal. Silakan coba lagi.', 'Aktifkan', 'Akses situs', 'Muat ulang tab yang terpengaruh.'],
  ru: ['Установить', 'Установка…', 'Установлено', 'Удалить', 'Удаление…', 'Проверка…', 'Операция не выполнена. Попробуйте ещё раз.', 'Включить', 'Доступ к сайтам', 'Обновите затронутые вкладки.'],
  it: ['Installa', 'Installazione…', 'Installato', 'Rimuovi', 'Rimozione…', 'Verifica…', 'Operazione non riuscita. Riprova.', 'Attiva', 'Accesso ai siti', 'Ricarica le schede interessate.'],
  ja: ['インストール', 'インストール中…', 'インストール済み', '削除', '削除中…', '確認中…', '操作に失敗しました。もう一度お試しください。', '有効にする', 'サイトへのアクセス', '対象のタブを再読み込みしてください。'],
}

const allSites: Record<NebulaLocale, string> = { tr: 'Tüm siteler', en: 'All websites', de: 'Alle Websites', es: 'Todos los sitios', fr: 'Tous les sites', id: 'Semua situs', ru: 'Все сайты', it: 'Tutti i siti', ja: 'すべてのサイト' }

export function extensionInstallCopy(locale: NebulaLocale) {
  const [install, installing, installed, remove, removing, checking, failed, enable, access, reload] = messages[locale]
  return { allSites: allSites[locale], install, installing, installed, remove, removing, checking, failed, enable, access, reload }
}
