import type { NebulaLocale } from './locale'

export const TUTORIAL_STARTED_KEY = 'nebula-guided-tutorial-started-v1'
export const TUTORIAL_COMPLETE_KEY = 'nebula-guided-tutorial-complete-v1'

export interface TutorialStepCopy {
  target: TutorialTargetId
  eyebrow: string
  title: string
  body: string
  action: string
}

export type TutorialTargetId =
  | 'top-edge'
  | 'semi-lunar'
  | 'home-search'
  | 'home-toolbar'

export interface TutorialCopy {
  categoryLabel: string
  categoryDescription: string
  intro: string
  start: string
  skipAll: string
  progress: string
  previous: string
  next: string
  finish: string
  restart: string
  completeTitle: string
  completeBody: string
  steps: readonly TutorialStepCopy[]
}

const COPY: Record<NebulaLocale, TutorialCopy> = {
  tr: {
    categoryLabel: 'Tutorial',
    categoryDescription: 'Nebula’nın temel kontrollerini kısa adımlarla öğren',
    intro: 'Nebula’nın temel kontrollerini ekranda gösteren kısa rehberi istediğin zaman yeniden başlat.',
    start: 'Ekran rehberini başlat',
    skipAll: 'Tümünü atla',
    progress: 'Adım',
    previous: 'Geri',
    next: 'İleri',
    finish: 'Bitir',
    restart: 'Baştan başla',
    completeTitle: 'Nebula’yı kullanmaya hazırsın',
    completeBody: 'Tutorial tamamlandı. İstediğin zaman bu menüden yeniden açabilirsin.',
    steps: [
      {
        target: 'top-edge',
        eyebrow: 'ÜST KENAR',
        title: 'Nebula burada uyanır',
        body: 'Bir sitedeyken tıklamadan imleci üst kenardaki parıltının üzerinde kısa süre tut. Semi-Lunar gerçek hover hareketiyle açılır.',
        action: 'Üst kenarda hover yap',
      },
      {
        target: 'semi-lunar',
        eyebrow: 'SEMI-LUNAR',
        title: 'Sekmelerin tek bakışta önünde',
        body: 'Açık sekmelerin burada simge olur. Semi-Lunar, imleç üzerindeyken açık kalır ve dışarı çıkınca kapanır. Parlayan YouTube örneğine hover yapınca site bilgileri görünür.',
        action: 'YouTube simgesine hover yap',
      },
      {
        target: 'home-search',
        eyebrow: 'ARA VEYA GİT',
        title: 'Her şey bu alandan başlar',
        body: 'Bir adres yazabilir veya doğrudan arama yapabilirsin. Bir sitedeyken Ctrl + L aynı alanı açar.',
        action: 'Ctrl + L',
      },
      {
        target: 'home-toolbar',
        eyebrow: 'HIZLI KONTROLLER',
        title: 'Ayarların her zaman yakınında',
        body: 'Ayarlar, bildirimler ve geçmiş ekranın sağında durur. İhtiyacın olan bölüme tek tıkla ulaş.',
        action: 'Sağ araç çubuğu',
      },
    ],
  },
  en: {
    categoryLabel: 'Tutorial',
    categoryDescription: 'Learn Nebula’s essential controls in a few short steps',
    intro: 'Restart the short on-screen guide to Nebula’s essential controls at any time.',
    start: 'Start on-screen guide',
    skipAll: 'Skip all',
    progress: 'Step',
    previous: 'Back',
    next: 'Next',
    finish: 'Finish',
    restart: 'Start again',
    completeTitle: 'You’re ready to use Nebula',
    completeBody: 'Tutorial complete. You can reopen it from this menu at any time.',
    steps: [
      { target: 'top-edge', eyebrow: 'TOP EDGE', title: 'Nebula wakes up here', body: 'While viewing a site, hover over the shimmer at the top edge without clicking. After a short pause, Semi-Lunar opens with its real hover behavior.', action: 'Hover at the top edge' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Your tabs at a glance', body: 'Open tabs appear here as icons. Semi-Lunar stays open while the pointer is over it and closes when you leave. Hover over the glowing YouTube sample to see its site details.', action: 'Hover over the YouTube icon' },
      { target: 'home-search', eyebrow: 'SEARCH OR GO', title: 'Everything starts here', body: 'Enter an address or search directly. While viewing a site, Ctrl + L opens the same field.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'QUICK CONTROLS', title: 'Settings stay close', body: 'Settings, notifications, and history stay at the right edge, one click away.', action: 'Right toolbar' },
    ],
  },
  es: {
    categoryLabel: 'Tutorial', categoryDescription: 'Aprende los controles esenciales de Nebula en pocos pasos',
    intro: 'Reinicia cuando quieras la breve guía en pantalla de los controles esenciales de Nebula.', start: 'Iniciar guía en pantalla', skipAll: 'Omitir todo', progress: 'Paso', previous: 'Atrás', next: 'Siguiente', finish: 'Finalizar', restart: 'Empezar de nuevo', completeTitle: 'Ya puedes usar Nebula', completeBody: 'Tutorial completado. Puedes abrirlo de nuevo desde este menú.',
    steps: [
      { target: 'top-edge', eyebrow: 'BORDE SUPERIOR', title: 'Nebula despierta aquí', body: 'En un sitio, mantén el puntero sobre el brillo del borde superior sin hacer clic. Semi-Lunar se abre tras una breve pausa.', action: 'Pasa el puntero por arriba' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Tus pestañas de un vistazo', body: 'Las pestañas aparecen aquí como iconos. Semi-Lunar permanece abierto mientras el puntero está encima y se cierra al salir. Pasa el puntero por el ejemplo brillante de YouTube para ver los detalles del sitio.', action: 'Pasa por el icono de YouTube' },
      { target: 'home-search', eyebrow: 'BUSCAR O IR', title: 'Todo empieza aquí', body: 'Escribe una dirección o busca directamente. En un sitio, Ctrl + L abre el mismo campo.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'CONTROLES RÁPIDOS', title: 'Tus ajustes están cerca', body: 'Ajustes, notificaciones e historial están en el borde derecho.', action: 'Barra derecha' },
    ],
  },
  de: {
    categoryLabel: 'Tutorial', categoryDescription: 'Lerne Nebulas wichtigste Bedienelemente in wenigen Schritten kennen',
    intro: 'Starte die kurze Bildschirmführung zu Nebulas wichtigsten Bedienelementen jederzeit neu.', start: 'Bildschirmführung starten', skipAll: 'Alles überspringen', progress: 'Schritt', previous: 'Zurück', next: 'Weiter', finish: 'Fertig', restart: 'Neu starten', completeTitle: 'Du kannst Nebula jetzt verwenden', completeBody: 'Tutorial abgeschlossen. Du kannst es jederzeit über dieses Menü erneut öffnen.',
    steps: [
      { target: 'top-edge', eyebrow: 'OBERER RAND', title: 'Hier wacht Nebula auf', body: 'Halte auf einer Website den Zeiger ohne Klick kurz über das Leuchten am oberen Rand. Semi-Lunar öffnet sich per Hover.', action: 'Am oberen Rand verweilen' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Deine Tabs auf einen Blick', body: 'Tabs erscheinen hier als Symbole. Semi-Lunar bleibt offen, solange der Zeiger darüber liegt, und schließt sich beim Verlassen. Fahre über das leuchtende YouTube-Beispiel, um die Website-Details zu sehen.', action: 'Über das YouTube-Symbol fahren' },
      { target: 'home-search', eyebrow: 'SUCHEN ODER ÖFFNEN', title: 'Alles beginnt hier', body: 'Gib eine Adresse ein oder suche direkt. Auf einer Website öffnet Strg + L dasselbe Feld.', action: 'Strg + L' },
      { target: 'home-toolbar', eyebrow: 'SCHNELLZUGRIFF', title: 'Einstellungen bleiben nah', body: 'Einstellungen, Benachrichtigungen und Verlauf liegen am rechten Rand.', action: 'Rechte Leiste' },
    ],
  },
  fr: {
    categoryLabel: 'Tutoriel', categoryDescription: 'Découvrir les commandes essentielles de Nebula en quelques étapes',
    intro: 'Relancez à tout moment le guide à l’écran des commandes essentielles de Nebula.', start: 'Lancer le guide à l’écran', skipAll: 'Tout passer', progress: 'Étape', previous: 'Retour', next: 'Suivant', finish: 'Terminer', restart: 'Recommencer', completeTitle: 'Vous êtes prêt à utiliser Nebula', completeBody: 'Tutoriel terminé. Vous pouvez le rouvrir depuis ce menu à tout moment.',
    steps: [
      { target: 'top-edge', eyebrow: 'BORD SUPÉRIEUR', title: 'Nebula s’éveille ici', body: 'Sur un site, laissez brièvement le pointeur sur la lueur en haut sans cliquer. Semi-Lunar s’ouvre par survol.', action: 'Survoler le bord supérieur' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Vos onglets en un coup d’œil', body: 'Les onglets apparaissent ici sous forme d’icônes. Semi-Lunar reste ouvert tant que le pointeur le survole et se ferme lorsqu’il sort. Survolez l’exemple YouTube lumineux pour afficher les détails du site.', action: 'Survoler l’icône YouTube' },
      { target: 'home-search', eyebrow: 'RECHERCHER OU ALLER', title: 'Tout commence ici', body: 'Saisissez une adresse ou lancez une recherche. Sur un site, Ctrl + L ouvre le même champ.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'COMMANDES RAPIDES', title: 'Vos réglages restent proches', body: 'Réglages, notifications et historique se trouvent sur le bord droit.', action: 'Barre de droite' },
    ],
  },
  id: {
    categoryLabel: 'Tutorial', categoryDescription: 'Pelajari kontrol utama Nebula dalam beberapa langkah singkat',
    intro: 'Mulai ulang panduan singkat di layar untuk kontrol utama Nebula kapan saja.', start: 'Mulai panduan layar', skipAll: 'Lewati semua', progress: 'Langkah', previous: 'Kembali', next: 'Berikutnya', finish: 'Selesai', restart: 'Mulai lagi', completeTitle: 'Anda siap menggunakan Nebula', completeBody: 'Tutorial selesai. Anda dapat membukanya lagi dari menu ini kapan saja.',
    steps: [
      { target: 'top-edge', eyebrow: 'TEPI ATAS', title: 'Nebula aktif dari sini', body: 'Saat membuka situs, tahan penunjuk sebentar di atas kilau tepi atas tanpa mengeklik. Semi-Lunar terbuka dengan hover.', action: 'Hover di tepi atas' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Tab dalam sekali lihat', body: 'Tab muncul di sini sebagai ikon. Semi-Lunar tetap terbuka selama penunjuk berada di atasnya dan menutup saat penunjuk keluar. Hover pada contoh YouTube yang menyala untuk melihat detail situs.', action: 'Hover pada ikon YouTube' },
      { target: 'home-search', eyebrow: 'CARI ATAU BUKA', title: 'Semuanya dimulai di sini', body: 'Masukkan alamat atau cari langsung. Saat di situs, Ctrl + L membuka kolom yang sama.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'KONTROL CEPAT', title: 'Pengaturan selalu dekat', body: 'Pengaturan, notifikasi, dan riwayat berada di sisi kanan.', action: 'Bilah kanan' },
    ],
  },
  ru: {
    categoryLabel: 'Обучение', categoryDescription: 'Освойте основные элементы Nebula за несколько коротких шагов',
    intro: 'Короткое экранное руководство по основным элементам Nebula можно запустить снова в любое время.', start: 'Запустить руководство', skipAll: 'Пропустить всё', progress: 'Шаг', previous: 'Назад', next: 'Далее', finish: 'Готово', restart: 'Начать заново', completeTitle: 'Nebula готова к работе', completeBody: 'Обучение завершено. Его можно снова открыть из этого меню.',
    steps: [
      { target: 'top-edge', eyebrow: 'ВЕРХНИЙ КРАЙ', title: 'Здесь просыпается Nebula', body: 'На сайте ненадолго задержите указатель на свечении у верхнего края, не нажимая. Semi-Lunar откроется по наведению.', action: 'Навести на верхний край' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Все вкладки перед глазами', body: 'Вкладки показаны здесь значками. Semi-Lunar открыт, пока указатель находится над ним, и закрывается после ухода. Наведите указатель на светящийся пример YouTube, чтобы увидеть сведения о сайте.', action: 'Навести на значок YouTube' },
      { target: 'home-search', eyebrow: 'ПОИСК ИЛИ АДРЕС', title: 'Всё начинается здесь', body: 'Введите адрес или запрос. На сайте Ctrl + L открывает это же поле.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'БЫСТРЫЕ ДЕЙСТВИЯ', title: 'Настройки всегда рядом', body: 'Настройки, уведомления и история находятся у правого края.', action: 'Правая панель' },
    ],
  },
  it: {
    categoryLabel: 'Tutorial', categoryDescription: 'Impara i controlli essenziali di Nebula in pochi passaggi',
    intro: 'Riavvia in qualsiasi momento la breve guida su schermo ai controlli essenziali di Nebula.', start: 'Avvia guida su schermo', skipAll: 'Salta tutto', progress: 'Passaggio', previous: 'Indietro', next: 'Avanti', finish: 'Fine', restart: 'Ricomincia', completeTitle: 'Sei pronto a usare Nebula', completeBody: 'Tutorial completato. Puoi riaprirlo da questo menu in qualsiasi momento.',
    steps: [
      { target: 'top-edge', eyebrow: 'BORDO SUPERIORE', title: 'Nebula si attiva qui', body: 'Su un sito, lascia per poco il puntatore sul bagliore in alto senza fare clic. Semi-Lunar si apre al passaggio del mouse.', action: 'Passa sul bordo superiore' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'Le schede a colpo d’occhio', body: 'Le schede appaiono qui come icone. Semi-Lunar resta aperto finché il puntatore è sopra e si chiude quando esce. Passa sull’esempio YouTube luminoso per vedere i dettagli del sito.', action: 'Passa sull’icona YouTube' },
      { target: 'home-search', eyebrow: 'CERCA O VAI', title: 'Tutto inizia qui', body: 'Inserisci un indirizzo o cerca direttamente. Su un sito, Ctrl + L apre lo stesso campo.', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'CONTROLLI RAPIDI', title: 'Le impostazioni sono vicine', body: 'Impostazioni, notifiche e cronologia si trovano sul bordo destro.', action: 'Barra destra' },
    ],
  },
  ja: {
    categoryLabel: 'チュートリアル', categoryDescription: 'Nebula の基本操作を短い手順で確認します',
    intro: 'Nebula の基本操作を示す短い画面ガイドは、いつでも再開できます。', start: '画面ガイドを開始', skipAll: 'すべてスキップ', progress: 'ステップ', previous: '戻る', next: '次へ', finish: '完了', restart: '最初から', completeTitle: 'Nebula を使う準備ができました', completeBody: 'チュートリアルは完了です。このメニューからいつでも開き直せます。',
    steps: [
      { target: 'top-edge', eyebrow: '画面上端', title: 'Nebula はここから開きます', body: 'サイト表示中、クリックせずに上端のきらめきへポインターを少し置くと、実際のホバー動作で Semi-Lunar が開きます。', action: '画面上端にポインターを置く' },
      { target: 'semi-lunar', eyebrow: 'SEMI-LUNAR', title: 'タブをひと目で確認', body: 'タブはここにアイコンで表示されます。Semi-Lunar はポインターが上にある間は開いたままで、外すと閉じます。光る YouTube の例にポインターを置くとサイト情報が表示されます。', action: 'YouTube アイコンにポインターを置く' },
      { target: 'home-search', eyebrow: '検索または移動', title: 'すべてはここから', body: 'アドレスや検索語を入力できます。サイト表示中は Ctrl + L で同じ欄を開けます。', action: 'Ctrl + L' },
      { target: 'home-toolbar', eyebrow: 'クイック操作', title: '設定はいつも近くに', body: '設定、通知、履歴は画面右端にあります。', action: '右ツールバー' },
    ],
  },
}

export function getTutorialCopy(locale: NebulaLocale): TutorialCopy {
  return COPY[locale]
}

export function startGuidedTutorial(): void {
  try {
    localStorage.setItem(TUTORIAL_STARTED_KEY, '1')
    localStorage.removeItem(TUTORIAL_COMPLETE_KEY)
  } catch {
    // The in-memory tour can still run when storage is unavailable.
  }
}

export function completeGuidedTutorial(): void {
  try {
    localStorage.setItem(TUTORIAL_COMPLETE_KEY, '1')
    localStorage.removeItem(TUTORIAL_STARTED_KEY)
  } catch {
    // Completion still closes the current in-memory tour.
  }
}

export function shouldResumeGuidedTutorial(): boolean {
  try {
    return (
      localStorage.getItem(TUTORIAL_STARTED_KEY) === '1' &&
      localStorage.getItem(TUTORIAL_COMPLETE_KEY) !== '1'
    )
  } catch {
    return false
  }
}
