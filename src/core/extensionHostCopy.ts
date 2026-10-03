import type { NebulaLocale } from './locale'

type Copy = readonly [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
const messages: Record<NebulaLocale, Copy> = {
  tr: ['Eklentiler', 'Henüz kurulu eklenti yok.', 'Eklentileri yönet', 'Kontrolleri aç', 'Seçenekler', 'Devre dışı bırak', 'Devre dışı', 'Bu ilk sürümde aktif sekmeyle etkileşim ve bazı oturum açma işlemleri çalışmayabilir.', 'Bu eklentinin istediği düğme veya yan panel desteği henüz hazır değil.', 'Eklentiler özel sekmelerde kullanılamaz.', 'Kurulumdan önce incele', 'İzinler', 'İptal', 'İndirme kontrolünü geçti. Bu, tüm özelliklerin çalıştığı anlamına gelmez.'],
  en: ['Extensions', 'No extensions installed yet.', 'Manage extensions', 'Open controls', 'Options', 'Disable', 'Disabled', 'In this first version, active-tab interactions and some sign-in flows may not work.', 'The action or side panel this extension needs is not supported yet.', 'Extensions are unavailable in private tabs.', 'Review before installing', 'Permissions', 'Cancel', 'The download check passed. This does not mean every feature works.'],
  de: ['Erweiterungen', 'Noch keine Erweiterungen installiert.', 'Erweiterungen verwalten', 'Steuerung öffnen', 'Optionen', 'Deaktivieren', 'Deaktiviert', 'In dieser ersten Version funktionieren Zugriffe auf den aktiven Tab und manche Anmeldungen möglicherweise nicht.', 'Die benötigte Aktion oder Seitenleiste wird noch nicht unterstützt.', 'Erweiterungen sind in privaten Tabs nicht verfügbar.', 'Vor der Installation prüfen', 'Berechtigungen', 'Abbrechen', 'Downloadprüfung bestanden. Nicht alle Funktionen sind damit bestätigt.'],
  es: ['Extensiones', 'Aún no hay extensiones instaladas.', 'Administrar extensiones', 'Abrir controles', 'Opciones', 'Desactivar', 'Desactivada', 'En esta primera versión, las interacciones con la pestaña activa y algunos inicios de sesión pueden fallar.', 'La acción o el panel lateral que necesita esta extensión aún no es compatible.', 'Las extensiones no están disponibles en pestañas privadas.', 'Revisar antes de instalar', 'Permisos', 'Cancelar', 'La comprobación de descarga pasó. Esto no confirma todas las funciones.'],
  fr: ['Extensions', 'Aucune extension installée.', 'Gérer les extensions', 'Ouvrir les commandes', 'Options', 'Désactiver', 'Désactivée', 'Dans cette première version, les interactions avec l’onglet actif et certaines connexions peuvent échouer.', 'L’action ou le panneau latéral requis n’est pas encore pris en charge.', 'Les extensions sont indisponibles dans les onglets privés.', 'Vérifier avant l’installation', 'Autorisations', 'Annuler', 'La vérification du téléchargement a réussi. Toutes les fonctions ne sont pas confirmées.'],
  id: ['Ekstensi', 'Belum ada ekstensi terpasang.', 'Kelola ekstensi', 'Buka kontrol', 'Opsi', 'Nonaktifkan', 'Nonaktif', 'Pada versi awal ini, interaksi tab aktif dan beberapa proses masuk mungkin tidak berfungsi.', 'Aksi atau panel samping yang diperlukan belum didukung.', 'Ekstensi tidak tersedia di tab privat.', 'Tinjau sebelum memasang', 'Izin', 'Batal', 'Pemeriksaan unduhan berhasil. Ini tidak memastikan semua fitur berfungsi.'],
  ru: ['Расширения', 'Расширения ещё не установлены.', 'Управление расширениями', 'Открыть управление', 'Параметры', 'Отключить', 'Отключено', 'В этой первой версии взаимодействие с активной вкладкой и некоторые способы входа могут не работать.', 'Нужное действие или боковая панель пока не поддерживается.', 'Расширения недоступны в приватных вкладках.', 'Проверить перед установкой', 'Разрешения', 'Отмена', 'Проверка загрузки пройдена. Работа всех функций не подтверждена.'],
  it: ['Estensioni', 'Nessuna estensione installata.', 'Gestisci estensioni', 'Apri controlli', 'Opzioni', 'Disattiva', 'Disattivata', 'In questa prima versione, le interazioni con la scheda attiva e alcuni accessi potrebbero non funzionare.', 'L’azione o il pannello laterale richiesto non è ancora supportato.', 'Le estensioni non sono disponibili nelle schede private.', 'Controlla prima di installare', 'Autorizzazioni', 'Annulla', 'Verifica del download superata. Non conferma tutte le funzionalità.'],
  ja: ['拡張機能', 'インストール済みの拡張機能はありません。', '拡張機能を管理', '操作画面を開く', 'オプション', '無効にする', '無効', 'この初期バージョンでは、アクティブなタブの操作や一部のログインが機能しない場合があります。', '必要なアクションやサイドパネルはまだサポートされていません。', 'プライベートタブでは拡張機能を利用できません。', 'インストール前に確認', '権限', 'キャンセル', 'ダウンロードの確認に成功しました。すべての機能の動作を保証するものではありません。'],
}

const runtime: Record<NebulaLocale, readonly [string, string]> = {
  tr: ["Sekmelerinle birlikte çalışır. Nebula’nın kendi ekranları (geçmiş, parolalar, ayarlar) erişiminin dışında kalır.", "Bu eklenti sekmelerinle birlikte çalışır ve açtığın sitelerdeki içeriği okuyabilir. Nebula’nın kendi ekranları (geçmiş, parolalar, ayarlar) erişiminin dışında tutulur; bunun için Nebula bir kez yeniden başlar ve eklenti bundan sonra açılır."],
  en: ["Runs with your tabs. Nebula’s own screens (history, passwords, settings) stay out of its reach.", "This extension runs together with your tabs and can read the websites you open. Nebula’s own screens (history, passwords, settings) are kept out of its reach; for that Nebula restarts once and the extension turns on after that."],
  de: ["Läuft zusammen mit deinen Tabs. Nebulas eigene Bildschirme (Verlauf, Passwörter, Einstellungen) bleiben außerhalb seiner Reichweite.", "Diese Erweiterung läuft zusammen mit deinen Tabs und kann die geöffneten Websites lesen. Nebulas eigene Bildschirme (Verlauf, Passwörter, Einstellungen) bleiben außerhalb ihrer Reichweite; dafür startet Nebula einmal neu und die Erweiterung wird danach aktiviert."],
  es: ["Funciona junto con tus pestañas. Las pantallas propias de Nebula (historial, contraseñas, ajustes) quedan fuera de su alcance.", "Esta extensión funciona junto con tus pestañas y puede leer los sitios que abres. Las pantallas propias de Nebula (historial, contraseñas, ajustes) quedan fuera de su alcance; para ello Nebula se reinicia una vez y la extensión se activa después."],
  fr: ["Fonctionne avec vos onglets. Les écrans propres à Nebula (historique, mots de passe, réglages) restent hors de sa portée.", "Cette extension fonctionne avec vos onglets et peut lire les sites que vous ouvrez. Les écrans propres à Nebula (historique, mots de passe, réglages) restent hors de sa portée ; pour cela Nebula redémarre une fois et l’extension s’active ensuite."],
  id: ["Berjalan bersama tabmu. Layar milik Nebula (riwayat, kata sandi, pengaturan) tetap di luar jangkauannya.", "Ekstensi ini berjalan bersama tabmu dan dapat membaca situs yang kamu buka. Layar milik Nebula (riwayat, kata sandi, pengaturan) tetap di luar jangkauannya; untuk itu Nebula dimulai ulang sekali dan ekstensi aktif setelahnya."],
  ru: ["Работает вместе с твоими вкладками. Собственные экраны Nebula (история, пароли, настройки) ему недоступны.", "Это расширение работает вместе с твоими вкладками и может читать открываемые сайты. Собственные экраны Nebula (история, пароли, настройки) остаются вне его досягаемости; для этого Nebula один раз перезапускается, и после этого расширение включается."],
  it: ["Funziona insieme alle tue schede. Le schermate di Nebula (cronologia, password, impostazioni) restano fuori dalla sua portata.", "Questa estensione funziona insieme alle tue schede e può leggere i siti che apri. Le schermate di Nebula (cronologia, password, impostazioni) restano fuori dalla sua portata; per questo Nebula si riavvia una volta e l’estensione si attiva dopo."],
  ja: ["タブと一緒に動作します。Nebula 自身の画面（履歴、パスワード、設定）には触れられません。", "この拡張機能はタブと一緒に動作し、開いたサイトを読み取れます。Nebula 自身の画面（履歴、パスワード、設定）は届かない場所に保たれます。そのために Nebula は一度再起動し、その後に拡張機能がオンになります。"],
}

const trial: Record<NebulaLocale, readonly [string, string, string]> = {
  tr: ['Deneme profili', 'Bu siteyi eklentilerle dene', 'Bu eklenti hâlâ eski deneme profilinde çalışıyor. Nebula kendi ekranlarını eklentilerden ayırınca ana profile taşınacak; kendi verisi (oturumlar gibi) taşınmaz.'],
  en: ['Trial profile', 'Try this site with extensions', 'This extension still runs in the old trial profile. It moves to your main profile once Nebula separates its own screens from extensions; its own data (such as sign-ins) does not move.'],
  de: ['Testprofil', 'Diese Website mit Erweiterungen testen', 'Diese Erweiterung läuft noch im alten Testprofil. Sie wechselt in dein Hauptprofil, sobald Nebula seine eigenen Bildschirme von Erweiterungen trennt; ihre eigenen Daten (z. B. Anmeldungen) wechseln nicht.'],
  es: ['Perfil de prueba', 'Probar este sitio con extensiones', 'Esta extensión aún funciona en el antiguo perfil de prueba. Pasará a tu perfil principal cuando Nebula separe sus propias pantallas de las extensiones; sus propios datos (como sesiones) no se mueven.'],
  fr: ['Profil d’essai', 'Tester ce site avec les extensions', 'Cette extension fonctionne encore dans l’ancien profil d’essai. Elle passera dans votre profil principal quand Nebula aura séparé ses propres écrans des extensions ; ses propres données (connexions, etc.) ne sont pas déplacées.'],
  id: ['Profil uji', 'Coba situs ini dengan ekstensi', 'Ekstensi ini masih berjalan di profil uji lama. Akan dipindahkan ke profil utamamu setelah Nebula memisahkan layarnya sendiri dari ekstensi; datanya sendiri (seperti sesi masuk) tidak dipindahkan.'],
  ru: ['Тестовый профиль', 'Проверить сайт с расширениями', 'Это расширение пока работает в прежнем тестовом профиле. Оно перейдёт в основной профиль, когда Nebula отделит от расширений свои экраны; собственные данные расширения (например, входы) не переносятся.'],
  it: ['Profilo di prova', 'Prova questo sito con le estensioni', 'Questa estensione funziona ancora nel vecchio profilo di prova. Passerà al profilo principale quando Nebula avrà separato le proprie schermate dalle estensioni; i suoi dati (come gli accessi) non vengono spostati.'],
  ja: ['テスト用プロファイル', 'このサイトで拡張機能を試す', 'この拡張機能はまだ以前のテスト用プロファイルで動作しています。Nebula が自身の画面を拡張機能から分離すると、メインプロファイルへ移されます。拡張機能自身のデータ（ログインなど）は移されません。'],
}
const statusUnavailable: Record<NebulaLocale, string> = {
  tr: 'Kurulu eklentiler okunamadı. Pencereye yeniden odaklandığında tekrar denenecek.',
  en: 'Installed extensions could not be read. Nebula will retry when the window regains focus.',
  de: 'Installierte Erweiterungen konnten nicht gelesen werden. Beim erneuten Fokussieren wird es erneut versucht.',
  es: 'No se pudieron leer las extensiones instaladas. Se volverá a intentar al enfocar la ventana.',
  fr: 'Impossible de lire les extensions installées. Un nouvel essai aura lieu au retour du focus.',
  id: 'Ekstensi terpasang tidak dapat dibaca. Nebula akan mencoba lagi saat jendela kembali difokuskan.',
  ru: 'Не удалось прочитать установленные расширения. Повторная попытка будет выполнена при возврате фокуса.',
  it: 'Impossibile leggere le estensioni installate. Verrà eseguito un nuovo tentativo quando la finestra torna attiva.',
  ja: 'インストール済みの拡張機能を読み取れませんでした。ウィンドウが再びアクティブになったときに再試行します。',
}

const hostStatus: Record<NebulaLocale, readonly [string, string, string, string, string]> = {
  tr: ['Paneli aç · Deneysel', 'Bu paketlenmiş panel açılabilir; Chrome yan panel yaşam döngüsünün tamamı henüz yok.', 'Eklentinin araç çubuğu tıklaması WebView2 tarafından host uygulamasına aktarılmıyor.', 'Eklentinin dinamik yan panel yolu WebView2 tarafından host uygulamasına aktarılmıyor.', 'Arka plan veya sayfa özellikleri içerir. Bu özelliklerin çalışması henüz doğrulanmadı.'],
  en: ['Open panel · Experimental', 'This packaged panel can open; the full Chrome side-panel lifecycle is not available yet.', 'WebView2 does not expose this extension’s toolbar click to the host app.', 'WebView2 does not expose this extension’s dynamic side-panel path to the host app.', 'Includes background or page features. Their functionality has not been verified.'],
  de: ['Panel öffnen · Experimentell', 'Dieses enthaltene Panel kann geöffnet werden; der vollständige Chrome-Seitenleistenablauf fehlt noch.', 'WebView2 gibt den Symbolleisten-Klick dieser Erweiterung nicht an die Host-App weiter.', 'WebView2 gibt den dynamischen Seitenleistenpfad nicht an die Host-App weiter.', 'Enthält Hintergrund- oder Seitenfunktionen. Ihre Funktion wurde noch nicht überprüft.'],
  es: ['Abrir panel · Experimental', 'Este panel incluido puede abrirse; aún no está disponible todo el ciclo del panel lateral de Chrome.', 'WebView2 no expone a la aplicación el clic de la barra de herramientas.', 'WebView2 no expone a la aplicación la ruta dinámica del panel lateral.', 'Incluye funciones de fondo o de página. Su funcionamiento aún no se ha verificado.'],
  fr: ['Ouvrir le panneau · Expérimental', 'Ce panneau inclus peut s’ouvrir ; le cycle complet du panneau latéral de Chrome reste indisponible.', 'WebView2 ne transmet pas le clic de barre d’outils à l’application hôte.', 'WebView2 ne transmet pas le chemin dynamique du panneau latéral à l’application hôte.', 'Contient des fonctions de fond ou de page. Leur fonctionnement n’a pas encore été vérifié.'],
  id: ['Buka panel · Eksperimental', 'Panel bawaan ini dapat dibuka; siklus panel samping Chrome lengkap belum tersedia.', 'WebView2 tidak meneruskan klik bilah alat ekstensi ini ke aplikasi host.', 'WebView2 tidak meneruskan jalur panel samping dinamis ke aplikasi host.', 'Mencakup fitur latar atau halaman. Fungsinya belum diverifikasi.'],
  ru: ['Открыть панель · Экспериментально', 'Встроенную панель можно открыть; полный цикл боковой панели Chrome пока недоступен.', 'WebView2 не передаёт приложению нажатие кнопки расширения.', 'WebView2 не передаёт приложению динамический путь боковой панели.', 'Содержит фоновые функции или функции страниц. Их работа ещё не проверена.'],
  it: ['Apri pannello · Sperimentale', 'Questo pannello incluso può aprirsi; il ciclo completo del pannello laterale di Chrome non è ancora disponibile.', 'WebView2 non espone all’app host il clic sulla barra degli strumenti.', 'WebView2 non espone all’app host il percorso dinamico del pannello laterale.', 'Include funzioni in background o nelle pagine. Il loro funzionamento non è ancora verificato.'],
  ja: ['パネルを開く・試験的', '同梱パネルは開けますが、Chrome のサイドパネルの完全なライフサイクルには未対応です。', 'WebView2 は拡張機能のツールバークリックをホストアプリに公開しません。', 'WebView2 は動的なサイドパネルのパスをホストアプリに公開しません。', 'バックグラウンド機能またはページ機能を含みます。これらの動作はまだ確認されていません。'],
}

const nativeApp: Record<NebulaLocale, string> = {
  tr: 'Bu eklenti bazı özellikler için bilgisayarda kurulu yardımcı uygulamasına ihtiyaç duyabilir.',
  en: 'This extension may require its companion desktop app for some features.',
  de: 'Diese Erweiterung benötigt für einige Funktionen möglicherweise ihre Desktop-Begleit-App.',
  es: 'Esta extensión puede necesitar su aplicación de escritorio para algunas funciones.',
  fr: 'Cette extension peut nécessiter son application de bureau pour certaines fonctions.',
  id: 'Ekstensi ini mungkin memerlukan aplikasi desktop pendamping untuk beberapa fitur.',
  ru: 'Для некоторых функций этому расширению может потребоваться приложение на компьютере.',
  it: 'Questa estensione potrebbe richiedere l’app desktop associata per alcune funzioni.',
  ja: '一部の機能には、この拡張機能のデスクトップ補助アプリが必要な場合があります。',
}

const metadataUnavailable: Record<NebulaLocale, string> = {
  tr: 'Kurulu paket bilgileri okunamadı. Eklentiyi kaldırıp yeniden kurabilirsin.',
  en: 'Installed package details could not be read. You can remove and reinstall the extension.',
  de: 'Die installierten Paketdaten konnten nicht gelesen werden. Du kannst die Erweiterung entfernen und neu installieren.',
  es: 'No se pudieron leer los datos del paquete instalado. Puedes eliminar y reinstalar la extensión.',
  fr: 'Impossible de lire les informations du paquet installé. Vous pouvez supprimer puis réinstaller l’extension.',
  id: 'Detail paket terpasang tidak dapat dibaca. Anda dapat menghapus dan memasang ulang ekstensi.',
  ru: 'Не удалось прочитать данные установленного пакета. Можно удалить и переустановить расширение.',
  it: 'Impossibile leggere i dati del pacchetto installato. Puoi rimuovere e reinstallare l’estensione.',
  ja: 'インストール済みパッケージの情報を読み取れませんでした。拡張機能を削除して再インストールできます。',
}

// [button, beta note, no response]
const clickAction: Record<NebulaLocale, readonly [string, string, string]> = {
  tr: ['Araç çubuğu eylemini çalıştır · Beta', 'Nebula bu eklentinin araç çubuğu tıklamasını taklit eder. Nebula, tarayıcı araç çubuğunun verdiği sayfa erişimini (activeTab) henüz veremediği için bazı eklentiler çalışmayabilir.', 'Bu eklenti araç çubuğu tıklamasına yanıt vermedi.'],
  en: ['Click toolbar action · Beta', 'Nebula emulates this extension’s toolbar click. Some extensions may not work yet because Nebula cannot grant page access (activeTab) the way a browser toolbar does.', 'This extension did not respond to a toolbar click.'],
  de: ['Symbolleistenaktion ausführen · Beta', 'Nebula ahmt den Symbolleisten-Klick dieser Erweiterung nach. Manche Erweiterungen funktionieren noch nicht, weil Nebula den Seitenzugriff (activeTab) nicht wie eine Browser-Symbolleiste gewähren kann.', 'Diese Erweiterung hat nicht auf den Symbolleisten-Klick reagiert.'],
  es: ['Ejecutar acción de la barra · Beta', 'Nebula simula el clic de la barra de herramientas de esta extensión. Algunas extensiones pueden no funcionar aún porque Nebula no puede conceder el acceso a la página (activeTab) como lo hace una barra de herramientas.', 'Esta extensión no respondió al clic de la barra de herramientas.'],
  fr: ['Exécuter l’action de la barre · Bêta', 'Nebula simule le clic de la barre d’outils de cette extension. Certaines extensions peuvent ne pas fonctionner, car Nebula ne peut pas accorder l’accès à la page (activeTab) comme une barre d’outils de navigateur.', 'Cette extension n’a pas répondu au clic de la barre d’outils.'],
  id: ['Jalankan aksi bilah alat · Beta', 'Nebula meniru klik bilah alat ekstensi ini. Beberapa ekstensi mungkin belum berfungsi karena Nebula belum dapat memberi akses halaman (activeTab) seperti bilah alat peramban.', 'Ekstensi ini tidak merespons klik bilah alat.'],
  ru: ['Выполнить действие панели · Бета', 'Nebula имитирует щелчок по значку расширения. Некоторые расширения могут пока не работать, так как Nebula не может выдать доступ к странице (activeTab), как это делает панель браузера.', 'Это расширение не ответило на щелчок по значку.'],
  it: ['Esegui azione della barra · Beta', 'Nebula simula il clic sulla barra degli strumenti di questa estensione. Alcune estensioni potrebbero non funzionare ancora perché Nebula non può concedere l’accesso alla pagina (activeTab) come una barra degli strumenti del browser.', 'Questa estensione non ha risposto al clic della barra degli strumenti.'],
  ja: ['ツールバーの操作を実行・ベータ', 'Nebula はこの拡張機能のツールバーのクリックを再現します。ブラウザのツールバーのようにページへのアクセス（activeTab）を付与できないため、動作しない拡張機能があります。', 'この拡張機能はツールバーのクリックに応答しませんでした。'],
}

const details: Record<NebulaLocale, string> = {
  tr: 'Ayrıntılar', en: 'Details', de: 'Details', es: 'Detalles', fr: 'Détails',
  id: 'Detail', ru: 'Подробности', it: 'Dettagli', ja: '詳細',
}

export function extensionHostCopy(locale: NebulaLocale) {
  const [title, empty, manage, open, options, disable, disabled, limited, missingHost, privateUnavailable, review, permissions, cancel, loadOnly] = messages[locale]
  const [trialProfile, trySite, separateSession] = trial[locale]
  const [runsWithTabs, reviewNote] = runtime[locale]
  const [openPanel, experimentalPanel, missingActionHost, missingSidePanel, runsInProfile] = hostStatus[locale]
  const [clickLabel, clickBeta, clickNoResponse] = clickAction[locale]
  return { title, empty, manage, open, options, disable, disabled, limited, missingHost, privateUnavailable, review, permissions, cancel, loadOnly, trialProfile, trySite, separateSession, runsWithTabs, reviewNote, openPanel, experimentalPanel, missingActionHost, missingSidePanel, runsInProfile, clickLabel, clickBeta, clickNoResponse, details: details[locale], requiresNativeApp: nativeApp[locale], statusUnavailable: statusUnavailable[locale], metadataUnavailable: metadataUnavailable[locale] }
}
