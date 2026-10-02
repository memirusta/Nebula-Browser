import type { NebulaLocale } from './locale'

export interface ShellIsolationCopy {
  title: string
  hint: string
  blocked: string
  on: string
  off: string
  enable: string
  disable: string
  confirmOn: string
  confirmOff: string
  failed: string
  /** Shown once after the app went back to its previous setup because a switch did not verify. */
  notice: string
}

const COPY: Record<NebulaLocale, ShellIsolationCopy> = {
  tr: {
    title: 'Nebula ekranlarını eklentilerden ayır',
    hint: 'Açıkken Nebula’nın kendi ekranları (geçmiş, ayarlar, parolalar) eklentisiz ayrı bir alanda çalışır; eklentiler yalnızca sekmelerde çalışır. Açarken Nebula yeniden başlar, sekmelerin ve ayarların geri gelir. Yaklaşık 260 MB daha bellek kullanır.',
    blocked: 'Etkin bir eklenti varken bu ayar kapatılamaz. Önce eklentileri kapat.',
    on: 'Açık',
    off: 'Kapalı',
    enable: 'Aç ve yeniden başlat',
    disable: 'Kapat ve yeniden başlat',
    confirmOn: 'Nebula yeniden başlayacak. Sekmelerin ve ayarların geri gelecek. Devam edilsin mi?',
    confirmOff: 'Nebula yeniden başlayacak ve tek alana dönecek. Sekmelerin ve ayarların geri gelecek. Devam edilsin mi?',
    failed: 'Geçiş yapılamadı. Nebula olduğu gibi çalışmaya devam ediyor, verilerine dokunulmadı.',
    notice: 'Ayırma işlemi doğrulanamadı, bu yüzden Nebula önceki düzenine döndü. Verilerin yerinde.',
  },
  en: {
    title: 'Keep Nebula’s own screens away from extensions',
    hint: 'When on, Nebula’s own screens (history, settings, passwords) run in a separate space with no extensions; extensions only run in tabs. Turning it on restarts Nebula and your tabs and settings come back. It uses about 260 MB more memory.',
    blocked: 'This cannot be turned off while an extension is enabled. Turn the extensions off first.',
    on: 'On',
    off: 'Off',
    enable: 'Turn on and restart',
    disable: 'Turn off and restart',
    confirmOn: 'Nebula will restart. Your tabs and settings will come back. Continue?',
    confirmOff: 'Nebula will restart and go back to a single space. Your tabs and settings will come back. Continue?',
    failed: 'The switch could not be made. Nebula keeps working as it was and your data was not touched.',
    notice: 'The switch could not be verified, so Nebula went back to its previous setup. Your data is untouched.',
  },
  de: {
    title: 'Nebulas eigene Bildschirme von Erweiterungen trennen',
    hint: 'Wenn aktiv, laufen Nebulas eigene Bildschirme (Verlauf, Einstellungen, Passwörter) in einem getrennten Bereich ohne Erweiterungen; Erweiterungen laufen nur in Tabs. Beim Einschalten startet Nebula neu, Tabs und Einstellungen kommen zurück. Es braucht etwa 260 MB mehr Speicher.',
    blocked: 'Solange eine Erweiterung aktiv ist, lässt sich das nicht ausschalten. Schalte zuerst die Erweiterungen aus.',
    on: 'An',
    off: 'Aus',
    enable: 'Einschalten und neu starten',
    disable: 'Ausschalten und neu starten',
    confirmOn: 'Nebula startet neu. Tabs und Einstellungen kommen zurück. Fortfahren?',
    confirmOff: 'Nebula startet neu und kehrt zu einem einzigen Bereich zurück. Tabs und Einstellungen kommen zurück. Fortfahren?',
    failed: 'Der Wechsel war nicht möglich. Nebula läuft unverändert weiter, deine Daten wurden nicht angetastet.',
    notice: 'Der Wechsel konnte nicht bestätigt werden, deshalb ist Nebula zur vorherigen Einrichtung zurückgekehrt. Deine Daten sind unverändert.',
  },
  es: {
    title: 'Mantener las pantallas de Nebula lejos de las extensiones',
    hint: 'Activado, las pantallas propias de Nebula (historial, ajustes, contraseñas) funcionan en un espacio aparte sin extensiones; las extensiones solo funcionan en las pestañas. Al activarlo, Nebula se reinicia y tus pestañas y ajustes vuelven. Usa unos 260 MB más de memoria.',
    blocked: 'No se puede desactivar mientras haya una extensión activa. Desactiva primero las extensiones.',
    on: 'Activado',
    off: 'Desactivado',
    enable: 'Activar y reiniciar',
    disable: 'Desactivar y reiniciar',
    confirmOn: 'Nebula se reiniciará. Tus pestañas y ajustes volverán. ¿Continuar?',
    confirmOff: 'Nebula se reiniciará y volverá a un solo espacio. Tus pestañas y ajustes volverán. ¿Continuar?',
    failed: 'No se pudo hacer el cambio. Nebula sigue funcionando como antes y tus datos no se tocaron.',
    notice: 'No se pudo verificar el cambio, así que Nebula volvió a su configuración anterior. Tus datos están intactos.',
  },
  fr: {
    title: 'Séparer les écrans de Nebula des extensions',
    hint: 'Activé, les écrans propres à Nebula (historique, réglages, mots de passe) fonctionnent dans un espace distinct sans extensions ; les extensions ne fonctionnent que dans les onglets. L’activation redémarre Nebula et vos onglets et réglages reviennent. Environ 260 Mo de mémoire en plus.',
    blocked: 'Impossible de désactiver tant qu’une extension est activée. Désactivez d’abord les extensions.',
    on: 'Activé',
    off: 'Désactivé',
    enable: 'Activer et redémarrer',
    disable: 'Désactiver et redémarrer',
    confirmOn: 'Nebula va redémarrer. Vos onglets et réglages reviendront. Continuer ?',
    confirmOff: 'Nebula va redémarrer et revenir à un seul espace. Vos onglets et réglages reviendront. Continuer ?',
    failed: 'Le changement n’a pas pu être fait. Nebula continue comme avant, vos données n’ont pas été touchées.',
    notice: 'Le changement n’a pas pu être vérifié, Nebula est donc revenu à sa configuration précédente. Vos données sont intactes.',
  },
  id: {
    title: 'Pisahkan layar Nebula dari ekstensi',
    hint: 'Saat aktif, layar milik Nebula (riwayat, pengaturan, kata sandi) berjalan di ruang terpisah tanpa ekstensi; ekstensi hanya berjalan di tab. Mengaktifkannya memulai ulang Nebula dan tab serta pengaturanmu kembali. Memakai sekitar 260 MB memori tambahan.',
    blocked: 'Tidak dapat dinonaktifkan selama ada ekstensi yang aktif. Nonaktifkan ekstensi terlebih dahulu.',
    on: 'Aktif',
    off: 'Nonaktif',
    enable: 'Aktifkan dan mulai ulang',
    disable: 'Nonaktifkan dan mulai ulang',
    confirmOn: 'Nebula akan dimulai ulang. Tab dan pengaturanmu akan kembali. Lanjutkan?',
    confirmOff: 'Nebula akan dimulai ulang dan kembali ke satu ruang. Tab dan pengaturanmu akan kembali. Lanjutkan?',
    failed: 'Peralihan tidak dapat dilakukan. Nebula tetap berjalan seperti semula dan datamu tidak disentuh.',
    notice: 'Peralihan tidak dapat diverifikasi, jadi Nebula kembali ke pengaturan sebelumnya. Datamu aman.',
  },
  ru: {
    title: 'Отделить экраны Nebula от расширений',
    hint: 'Когда включено, собственные экраны Nebula (история, настройки, пароли) работают в отдельном пространстве без расширений; расширения работают только во вкладках. При включении Nebula перезапускается, вкладки и настройки возвращаются. Нужно около 260 МБ памяти дополнительно.',
    blocked: 'Пока включено хотя бы одно расширение, это нельзя выключить. Сначала отключи расширения.',
    on: 'Включено',
    off: 'Выключено',
    enable: 'Включить и перезапустить',
    disable: 'Выключить и перезапустить',
    confirmOn: 'Nebula перезапустится. Вкладки и настройки вернутся. Продолжить?',
    confirmOff: 'Nebula перезапустится и вернётся к одному пространству. Вкладки и настройки вернутся. Продолжить?',
    failed: 'Переключиться не удалось. Nebula работает как раньше, твои данные не затронуты.',
    notice: 'Переключение не удалось проверить, поэтому Nebula вернулась к прежней настройке. Твои данные не затронуты.',
  },
  it: {
    title: 'Tieni le schermate di Nebula lontane dalle estensioni',
    hint: 'Quando è attivo, le schermate di Nebula (cronologia, impostazioni, password) funzionano in uno spazio separato senza estensioni; le estensioni funzionano solo nelle schede. Attivandolo Nebula si riavvia e schede e impostazioni tornano. Usa circa 260 MB di memoria in più.',
    blocked: 'Non si può disattivare finché un’estensione è attiva. Disattiva prima le estensioni.',
    on: 'Attivo',
    off: 'Disattivo',
    enable: 'Attiva e riavvia',
    disable: 'Disattiva e riavvia',
    confirmOn: 'Nebula si riavvierà. Schede e impostazioni torneranno. Continuare?',
    confirmOff: 'Nebula si riavvierà e tornerà a un solo spazio. Schede e impostazioni torneranno. Continuare?',
    failed: 'Non è stato possibile cambiare. Nebula continua a funzionare come prima e i tuoi dati non sono stati toccati.',
    notice: 'Non è stato possibile verificare il cambio, quindi Nebula è tornato alla configurazione precedente. I tuoi dati sono intatti.',
  },
  ja: {
    title: 'Nebula の画面を拡張機能から分離する',
    hint: 'オンにすると、Nebula 自身の画面（履歴、設定、パスワード）は拡張機能のない別の領域で動作し、拡張機能はタブの中だけで動作します。オンにすると Nebula が再起動し、タブと設定は元に戻ります。メモリを約 260 MB 多く使用します。',
    blocked: '拡張機能が有効な間はオフにできません。先に拡張機能をオフにしてください。',
    on: 'オン',
    off: 'オフ',
    enable: 'オンにして再起動',
    disable: 'オフにして再起動',
    confirmOn: 'Nebula が再起動します。タブと設定は元に戻ります。続けますか？',
    confirmOff: 'Nebula が再起動し、単一の領域に戻ります。タブと設定は元に戻ります。続けますか？',
    failed: '切り替えできませんでした。Nebula はそのまま動作し、データには触れていません。',
    notice: '切り替えを確認できなかったため、Nebula は以前の構成に戻りました。データはそのままです。',
  },
}

export function shellIsolationCopy(locale: NebulaLocale): ShellIsolationCopy {
  return COPY[locale]
}
