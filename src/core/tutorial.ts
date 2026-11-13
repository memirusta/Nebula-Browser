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
  | 'home-widgets'
  | 'home-toolbar'
  | 'shield'

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
  /** The button of the first step that opens the menu without the pointer. */
  showMenu: string
  /** The one sentence of the dark opening scene of the first tour. */
  introPrompt: string
  completeTitle: string
  completeBody: string
  steps: readonly TutorialStepCopy[]
}

const COPY: Record<NebulaLocale, TutorialCopy> = {
  tr: {
    categoryLabel: 'Hızlı tanıtım',
    categoryDescription: 'Nebula’nın temel kontrollerini kısa adımlarla öğren',
    intro: 'Nebula’nın temel kontrollerini ekranda gösteren kısa rehberi istediğin zaman yeniden başlat.',
    start: 'Ekran rehberini başlat',
    skipAll: 'Turu atla',
    progress: 'Adım',
    previous: 'Geri',
    next: 'İleri',
    finish: 'Bitir',
    restart: 'Baştan başla', showMenu: 'Menüyü göster', introPrompt: 'Fare imlecini ekranın en üstüne götür',
    completeTitle: 'Nebula’yı kullanmaya hazırsın',
    completeBody: 'Tutorial tamamlandı. İstediğin zaman bu menüden yeniden açabilirsin.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "ÜST KENAR",
        "title": "Menüyü üst kenardan aç",
        "body": "İmleci ekranın üst kenarında kısa süre beklet. Semi-Lunar açılır; imleci uzaklaştırınca kapanır.",
        "action": "İmleci yukarı götür; tıklaman gerekmez."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "SEKMELER",
        "title": "Sekmelerin burada",
        "body": "Her simge açık bir sekmedir. Tıklayarak geçebilir, üzerinde bekleyerek bilgilerini görebilirsin. Simgeleri sürükleyip istediğin yere bırak; birini diğerinin üstünde bekletirsen klasör olur.",
        "action": "YouTube örneğinin üzerinde bekle."
      },
      {
        "target": "home-search",
        "eyebrow": "ARAMA",
        "title": "Bir adres yaz veya ara",
        "body": "Semi-Lunar’ı üst kenardan açarak adres alanını kullanabilir veya Ctrl + L ile doğrudan odaklayabilirsin.",
        "action": "Semi-Lunar’ı aç veya kısayolu kullan"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODÜLLER",
        "title": "Ana sayfan, senin modüllerin",
        "body": "Soldaki kartlar RAM ve CPU gibi bilgileri gösterir. + ile yenisini ekleyebilir, düzenleme modunda sürükleyip boyutlandırabilirsin.",
        "action": "Düzenlemek için: Ayarlar → Ana Sayfa → Arayüzü düzenle."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "ARAÇLAR",
        "title": "Sık kullandıkların sağda",
        "body": "Ayarları, bildirimleri ve geçmişi sağdaki düğmelerden açabilirsin. Ayarlar'da tema, renk paleti ve yazı tipini seçer, Semi-Lunar'ı kişiselleştirirsin.",
        "action": "Dişliye bas, Ayarlar açılır."
      },
      {
        "target": "shield",
        "eyebrow": "KALKAN",
        "title": "Korunuyorsun",
        "body": "Nebula reklamları ve izleyicileri uBlock Origin Lite ile, çerez bannerlarını kendi kalkanıyla engeller. Bir site bozulursa o site için korumayı site bilgisinden kapatabilirsin.",
        "action": "Hiçbir şey yapman gerekmiyor."
      }
    ],
  },
  en: {
    categoryLabel: "Quick tour",
    categoryDescription: 'Learn Nebula’s essential controls in a few short steps',
    intro: 'Restart the short on-screen guide to Nebula’s essential controls at any time.',
    start: 'Start on-screen guide',
    skipAll: 'Skip all',
    progress: 'Step',
    previous: 'Back',
    next: 'Next',
    finish: 'Finish',
    restart: 'Start again', showMenu: 'Show the menu', introPrompt: 'Move your pointer to the top of the screen',
    completeTitle: 'You’re ready to use Nebula',
    completeBody: 'Tutorial complete. You can reopen it from this menu at any time.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "TOP EDGE",
        "title": "Open the menu from the top",
        "body": "Hold the pointer at the top edge for a moment. Semi-Lunar opens, then closes when you move away.",
        "action": "Move your pointer up; no click needed."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "TABS",
        "title": "Your tabs live here",
        "body": "Each icon is an open tab. Click to switch, or hover to preview its details. Drag icons wherever you like, and hold one over another to make a folder.",
        "action": "Hover over the YouTube example."
      },
      {
        "target": "home-search",
        "eyebrow": "SEARCH",
        "title": "Type an address or search",
        "body": "Open Semi-Lunar from the top edge to use its address field, or focus it directly with Ctrl + L.",
        "action": "Open Semi-Lunar or use the shortcut"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODULES",
        "title": "Your home page, your modules",
        "body": "The cards on the left show things like memory and CPU use. Press + to add more, and drag or resize them in edit mode.",
        "action": "To edit: Settings → Home → Edit UI."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "TOOLS",
        "title": "Everyday tools, close by",
        "body": "Open settings, notifications, and history with the buttons on the right. In Settings you pick the theme, colour palette and font, and customize Semi-Lunar.",
        "action": "Tap the gear to open Settings."
      },
      {
        "target": "shield",
        "eyebrow": "SHIELD",
        "title": "You're protected",
        "body": "Nebula blocks ads and trackers with uBlock Origin Lite and cookie banners with its own shield. If a site breaks, you can turn the protection off for that site from its site info.",
        "action": "Nothing for you to do."
      }
    ],
  },
  es: {
    categoryLabel: "Guía rápida", categoryDescription: 'Aprende los controles esenciales de Nebula en pocos pasos',
    intro: 'Reinicia cuando quieras la breve guía en pantalla de los controles esenciales de Nebula.', start: 'Iniciar guía en pantalla', skipAll: 'Omitir todo', progress: 'Paso', previous: 'Atrás', next: 'Siguiente', finish: 'Finalizar', restart: 'Empezar de nuevo', showMenu: 'Mostrar el menú', introPrompt: 'Lleva el puntero a la parte superior de la pantalla', completeTitle: 'Ya puedes usar Nebula', completeBody: 'Tutorial completado. Puedes abrirlo de nuevo desde este menú.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "BORDE SUPERIOR",
        "title": "Abre el menú desde arriba",
        "body": "Deja el puntero un momento en el borde superior. Semi-Lunar se abre y se cierra cuando te alejas.",
        "action": "Lleva el puntero arriba, sin hacer clic."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "PESTAÑAS",
        "title": "Tus pestañas están aquí",
        "body": "Cada icono es una pestaña abierta. Haz clic para cambiar o deja el puntero encima para ver sus detalles. Arrastra los iconos donde quieras y mantén uno sobre otro para crear una carpeta.",
        "action": "Pasa el puntero sobre el ejemplo de YouTube."
      },
      {
        "target": "home-search",
        "eyebrow": "BUSCAR",
        "title": "Escribe una dirección o busca",
        "body": "Abre Semi-Lunar desde el borde superior para usar el campo de dirección, o enfócalo con Ctrl + L.",
        "action": "Abre Semi-Lunar o usa el atajo"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MÓDULOS",
        "title": "Tu inicio, tus módulos",
        "body": "Las tarjetas de la izquierda muestran datos como la memoria y la CPU. Pulsa + para añadir más y arrástralas o cambia su tamaño en el modo de edición.",
        "action": "Para editar: Ajustes → Inicio → Editar interfaz de usuario."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "HERRAMIENTAS",
        "title": "Lo esencial, a tu derecha",
        "body": "Abre los ajustes, las notificaciones y el historial con los botones de la derecha. En Ajustes eliges el tema, la paleta de colores y la fuente, y personalizas Semi-Lunar.",
        "action": "Pulsa el engranaje para abrir los ajustes."
      },
      {
        "target": "shield",
        "eyebrow": "ESCUDO",
        "title": "Tu navegación está protegida",
        "body": "Nebula bloquea anuncios y rastreadores con uBlock Origin Lite y los banners de cookies con su propio escudo. Si un sitio falla, puedes desactivar la protección para ese sitio desde su información.",
        "action": "No tienes que hacer nada."
      }
    ],
  },
  de: {
    categoryLabel: "Kurze Tour", categoryDescription: 'Lerne Nebulas wichtigste Bedienelemente in wenigen Schritten kennen',
    intro: 'Starte die kurze Bildschirmführung zu Nebulas wichtigsten Bedienelementen jederzeit neu.', start: 'Bildschirmführung starten', skipAll: 'Alles überspringen', progress: 'Schritt', previous: 'Zurück', next: 'Weiter', finish: 'Fertig', restart: 'Neu starten', showMenu: 'Menü anzeigen', introPrompt: 'Bewege den Zeiger an den oberen Bildschirmrand', completeTitle: 'Du kannst Nebula jetzt verwenden', completeBody: 'Tutorial abgeschlossen. Du kannst es jederzeit über dieses Menü erneut öffnen.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "OBERER RAND",
        "title": "Öffne das Menü am oberen Rand",
        "body": "Halte den Zeiger kurz an den oberen Rand. Semi-Lunar öffnet sich und schließt beim Wegbewegen.",
        "action": "Bewege den Zeiger nach oben, ohne zu klicken."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "TABS",
        "title": "Hier sind deine Tabs",
        "body": "Jedes Symbol ist ein geöffneter Tab. Klicke zum Wechseln darauf oder halte den Zeiger darüber, um Tabdetails zu sehen. Ziehe Symbole, wohin du willst, und halte eines über einem anderen, um einen Ordner zu erstellen.",
        "action": "Fahre über das YouTube-Beispiel."
      },
      {
        "target": "home-search",
        "eyebrow": "SUCHE",
        "title": "Adresse eingeben oder suchen",
        "body": "Öffne Semi-Lunar am oberen Rand, um das Adressfeld zu nutzen, oder fokussiere es direkt mit Ctrl + L.",
        "action": "Semi-Lunar öffnen oder Tastenkürzel nutzen"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODULE",
        "title": "Deine Startseite, deine Module",
        "body": "Die Karten links zeigen zum Beispiel Arbeitsspeicher und CPU-Auslastung. Mit + fügst du weitere hinzu und kannst sie im Bearbeitungsmodus ziehen und in der Größe ändern.",
        "action": "Zum Bearbeiten: Einstellungen → Startseite → Oberfläche bearbeiten."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "WERKZEUGE",
        "title": "Deine Werkzeuge rechts",
        "body": "Die Schaltflächen rechts öffnen Einstellungen, Benachrichtigungen und Verlauf. In den Einstellungen wählst du Design, Farbpalette und Schrift und passt Semi-Lunar an.",
        "action": "Tippe auf das Zahnrad, um die Einstellungen zu öffnen."
      },
      {
        "target": "shield",
        "eyebrow": "SCHUTZ",
        "title": "Du bist geschützt",
        "body": "Nebula blockiert Werbung und Tracker mit uBlock Origin Lite und Cookie-Banner mit einem eigenen Schutz. Funktioniert eine Website nicht richtig, kannst du den Schutz für sie in den Website-Infos ausschalten.",
        "action": "Du musst nichts tun."
      }
    ],
  },
  fr: {
    categoryLabel: "Visite rapide", categoryDescription: 'Découvrir les commandes essentielles de Nebula en quelques étapes',
    intro: 'Relancez à tout moment le guide à l’écran des commandes essentielles de Nebula.', start: 'Lancer le guide à l’écran', skipAll: 'Tout passer', progress: 'Étape', previous: 'Retour', next: 'Suivant', finish: 'Terminer', restart: 'Recommencer', showMenu: 'Afficher le menu', introPrompt: 'Amène le pointeur en haut de l’écran', completeTitle: 'Vous êtes prêt à utiliser Nebula', completeBody: 'Tutoriel terminé. Vous pouvez le rouvrir depuis ce menu à tout moment.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "BORD SUPÉRIEUR",
        "title": "Ouvre le menu par le haut",
        "body": "Garde le pointeur un instant au bord supérieur. Semi-Lunar s’ouvre et se ferme quand tu t’éloignes.",
        "action": "Déplace le pointeur en haut, sans cliquer."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "ONGLETS",
        "title": "Tes onglets sont ici",
        "body": "Chaque icône représente un onglet ouvert. Clique pour l’ouvrir ou laisse le pointeur dessus pour voir ses informations. Fais glisser les icônes où tu veux et maintiens-en une sur une autre pour créer un dossier.",
        "action": "Survole l’exemple YouTube."
      },
      {
        "target": "home-search",
        "eyebrow": "RECHERCHE",
        "title": "Saisis une adresse ou cherche",
        "body": "Ouvre Semi-Lunar depuis le bord supérieur pour utiliser le champ d’adresse, ou active-le avec Ctrl + L.",
        "action": "Ouvre Semi-Lunar ou utilise le raccourci"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODULES",
        "title": "Ton accueil, tes modules",
        "body": "Les cartes à gauche affichent par exemple la mémoire et le processeur. Appuie sur + pour en ajouter, puis fais-les glisser ou redimensionne-les en mode édition.",
        "action": "Pour modifier : Réglages → Accueil → Modifier l’interface."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "OUTILS",
        "title": "Tes outils à portée de main",
        "body": "Les boutons à droite ouvrent les réglages, les notifications et l’historique. Dans les réglages, tu choisis le thème, la palette de couleurs et la police, et tu personnalises Semi-Lunar.",
        "action": "Appuie sur la roue dentée pour ouvrir les réglages."
      },
      {
        "target": "shield",
        "eyebrow": "PROTECTION",
        "title": "Ta navigation est protégée",
        "body": "Nebula bloque les publicités et les traqueurs avec uBlock Origin Lite, et les bandeaux de cookies avec sa propre protection. Si un site ne fonctionne pas, tu peux désactiver la protection pour ce site depuis ses informations.",
        "action": "Tu n’as rien à faire."
      }
    ],
  },
  id: {
    categoryLabel: "Panduan singkat", categoryDescription: 'Pelajari kontrol utama Nebula dalam beberapa langkah singkat',
    intro: 'Mulai ulang panduan singkat di layar untuk kontrol utama Nebula kapan saja.', start: 'Mulai panduan layar', skipAll: 'Lewati semua', progress: 'Langkah', previous: 'Kembali', next: 'Berikutnya', finish: 'Selesai', restart: 'Mulai lagi', showMenu: 'Tampilkan menu', introPrompt: 'Gerakkan penunjuk ke bagian atas layar', completeTitle: 'Anda siap menggunakan Nebula', completeBody: 'Tutorial selesai. Anda dapat membukanya lagi dari menu ini kapan saja.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "TEPI ATAS",
        "title": "Buka menu dari tepi atas",
        "body": "Tahan penunjuk sebentar di tepi atas. Semi-Lunar terbuka dan menutup saat penunjuk menjauh.",
        "action": "Geser penunjuk ke atas, tanpa mengeklik."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "TAB",
        "title": "Tab Anda ada di sini",
        "body": "Setiap ikon adalah tab yang terbuka. Klik untuk berpindah atau tahan penunjuk di atasnya untuk melihat informasi tab. Seret ikon ke mana saja, dan tahan satu ikon di atas ikon lain untuk membuat folder.",
        "action": "Arahkan penunjuk ke contoh YouTube."
      },
      {
        "target": "home-search",
        "eyebrow": "CARI",
        "title": "Ketik alamat atau cari",
        "body": "Buka Semi-Lunar dari tepi atas untuk memakai kolom alamat, atau fokuskan langsung dengan Ctrl + L.",
        "action": "Buka Semi-Lunar atau gunakan pintasan"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODUL",
        "title": "Berandamu, modulmu",
        "body": "Kartu di kiri menampilkan hal seperti penggunaan memori dan CPU. Tekan + untuk menambah, lalu seret atau ubah ukurannya dalam mode edit.",
        "action": "Untuk mengedit: Pengaturan → Beranda → Edit antarmuka."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "ALAT",
        "title": "Alat sehari-hari di kanan",
        "body": "Tombol di kanan membuka pengaturan, notifikasi, dan riwayat. Di Pengaturan kamu memilih tema, palet warna, dan font, serta menyesuaikan Semi-Lunar.",
        "action": "Ketuk roda gigi untuk membuka Pengaturan."
      },
      {
        "target": "shield",
        "eyebrow": "PERLINDUNGAN",
        "title": "Kamu terlindungi",
        "body": "Nebula memblokir iklan dan pelacak dengan uBlock Origin Lite, serta banner cookie dengan perlindungannya sendiri. Jika sebuah situs bermasalah, kamu dapat mematikan perlindungan untuk situs itu dari info situs.",
        "action": "Kamu tidak perlu berbuat apa-apa."
      }
    ],
  },
  ru: {
    categoryLabel: "Краткий обзор", categoryDescription: 'Освойте основные элементы Nebula за несколько коротких шагов',
    intro: 'Короткое экранное руководство по основным элементам Nebula можно запустить снова в любое время.', start: 'Запустить руководство', skipAll: 'Пропустить всё', progress: 'Шаг', previous: 'Назад', next: 'Далее', finish: 'Готово', restart: 'Начать заново', showMenu: 'Показать меню', introPrompt: 'Подведите указатель к верхнему краю экрана', completeTitle: 'Nebula готова к работе', completeBody: 'Обучение завершено. Его можно снова открыть из этого меню.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "ВЕРХНИЙ КРАЙ",
        "title": "Откройте меню сверху",
        "body": "Ненадолго задержите указатель у верхнего края. Semi-Lunar откроется и закроется, когда вы отведёте указатель.",
        "action": "Подведите указатель вверх, не нажимая."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "ВКЛАДКИ",
        "title": "Здесь ваши вкладки",
        "body": "Каждый значок — открытая вкладка. Нажмите для перехода или задержите указатель, чтобы увидеть сведения о вкладке. Перетаскивайте значки куда угодно, а если задержать один над другим, получится папка.",
        "action": "Наведите указатель на пример YouTube."
      },
      {
        "target": "home-search",
        "eyebrow": "ПОИСК",
        "title": "Введите адрес или запрос",
        "body": "Откройте Semi-Lunar у верхнего края, чтобы использовать адресную строку, или перейдите к ней с помощью Ctrl + L.",
        "action": "Откройте Semi-Lunar или используйте сочетание"
      },
      {
        "target": "home-widgets",
        "eyebrow": "МОДУЛИ",
        "title": "Ваша главная, ваши модули",
        "body": "Карточки слева показывают, например, загрузку памяти и процессора. Нажмите +, чтобы добавить новые, а в режиме редактирования их можно перетаскивать и менять размер.",
        "action": "Чтобы изменить: Настройки → Главная → Изменить интерфейс."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "ИНСТРУМЕНТЫ",
        "title": "Нужные инструменты справа",
        "body": "Кнопки справа открывают настройки, уведомления и историю. В настройках выбираются тема, цветовая палитра и шрифт, а также настраивается Semi-Lunar.",
        "action": "Нажмите на шестерёнку, чтобы открыть настройки."
      },
      {
        "target": "shield",
        "eyebrow": "ЗАЩИТА",
        "title": "Вы под защитой",
        "body": "Nebula блокирует рекламу и трекеры с помощью uBlock Origin Lite, а баннеры cookie — собственной защитой. Если сайт работает неправильно, защиту для него можно отключить в сведениях о сайте.",
        "action": "Ничего делать не нужно."
      }
    ],
  },
  it: {
    categoryLabel: "Tour rapido", categoryDescription: 'Impara i controlli essenziali di Nebula in pochi passaggi',
    intro: 'Riavvia in qualsiasi momento la breve guida su schermo ai controlli essenziali di Nebula.', start: 'Avvia guida su schermo', skipAll: 'Salta tutto', progress: 'Passaggio', previous: 'Indietro', next: 'Avanti', finish: 'Fine', restart: 'Ricomincia', showMenu: 'Mostra il menu', introPrompt: 'Porta il puntatore in cima allo schermo', completeTitle: 'Sei pronto a usare Nebula', completeBody: 'Tutorial completato. Puoi riaprirlo da questo menu in qualsiasi momento.',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "BORDO SUPERIORE",
        "title": "Apri il menu dall’alto",
        "body": "Tieni il puntatore per un momento sul bordo superiore. Semi-Lunar si apre e si chiude quando ti allontani.",
        "action": "Sposta il puntatore in alto, senza fare clic."
      },
      {
        "target": "semi-lunar",
        "eyebrow": "SCHEDE",
        "title": "Le tue schede sono qui",
        "body": "Ogni icona è una scheda aperta. Fai clic per aprirla o lascia il puntatore sopra per vedere i dettagli della scheda. Trascina le icone dove vuoi e tienine una sopra un’altra per creare una cartella.",
        "action": "Passa sull’esempio di YouTube."
      },
      {
        "target": "home-search",
        "eyebrow": "CERCA",
        "title": "Scrivi un indirizzo o cerca",
        "body": "Apri Semi-Lunar dal bordo superiore per usare il campo dell’indirizzo, oppure attivalo con Ctrl + L.",
        "action": "Apri Semi-Lunar o usa la scorciatoia"
      },
      {
        "target": "home-widgets",
        "eyebrow": "MODULI",
        "title": "La tua home, i tuoi moduli",
        "body": "Le schede a sinistra mostrano, per esempio, memoria e uso della CPU. Premi + per aggiungerne altre e, in modalità modifica, trascinale o ridimensionale.",
        "action": "Per modificare: Impostazioni → Home → Modifica interfaccia."
      },
      {
        "target": "home-toolbar",
        "eyebrow": "STRUMENTI",
        "title": "I tuoi strumenti a destra",
        "body": "I pulsanti a destra aprono impostazioni, notifiche e cronologia. Nelle Impostazioni scegli tema, tavolozza dei colori e carattere e personalizzi Semi-Lunar.",
        "action": "Tocca l’ingranaggio per aprire le Impostazioni."
      },
      {
        "target": "shield",
        "eyebrow": "PROTEZIONE",
        "title": "La tua navigazione è protetta",
        "body": "Nebula blocca pubblicità e tracker con uBlock Origin Lite e i banner dei cookie con una protezione propria. Se un sito non funziona, puoi disattivare la protezione per quel sito dalle sue informazioni.",
        "action": "Non devi fare nulla."
      }
    ],
  },
  ja: {
    categoryLabel: "クイックガイド", categoryDescription: 'Nebula の基本操作を短い手順で確認します',
    intro: 'Nebula の基本操作を示す短い画面ガイドは、いつでも再開できます。', start: '画面ガイドを開始', skipAll: 'すべてスキップ', progress: 'ステップ', previous: '戻る', next: '次へ', finish: '完了', restart: '最初から', showMenu: 'メニューを表示', introPrompt: 'ポインターを画面の上端へ動かしてください', completeTitle: 'Nebula を使う準備ができました', completeBody: 'チュートリアルは完了です。このメニューからいつでも開き直せます。',
    steps: [
      {
        "target": "top-edge",
        "eyebrow": "画面上端",
        "title": "上端からメニューを開く",
        "body": "上端にポインターを少し置くと Semi-Lunar が開きます。ポインターを離すと閉じます。",
        "action": "クリックせず、ポインターを上端へ。"
      },
      {
        "target": "semi-lunar",
        "eyebrow": "タブ",
        "title": "タブはここに並びます",
        "body": "各アイコンは開いているタブです。クリックして切り替えたり、ポインターを置いてタブ情報を確認したりできます。アイコンは好きな場所へドラッグでき、別のアイコンの上で止めるとフォルダーになります。",
        "action": "YouTube の例にポインターを置いてみましょう。"
      },
      {
        "target": "home-search",
        "eyebrow": "検索",
        "title": "アドレス入力や検索",
        "body": "上端から Semi-Lunar を開いてアドレス欄を使うか、Ctrl + L で直接フォーカスできます。",
        "action": "Semi-Lunar を開くかショートカットを使う"
      },
      {
        "target": "home-widgets",
        "eyebrow": "モジュール",
        "title": "ホームを自分好みに",
        "body": "左のカードにはメモリや CPU の使用状況などが表示されます。＋で追加でき、編集モードではドラッグや大きさの変更もできます。",
        "action": "編集するには：設定 → ホーム → インターフェイスを編集。"
      },
      {
        "target": "home-toolbar",
        "eyebrow": "ツール",
        "title": "よく使う機能は右側に",
        "body": "右側のボタンから設定、通知、履歴を開けます。設定ではテーマ、カラーパレット、フォントを選び、Semi-Lunar をカスタマイズできます。",
        "action": "歯車を押すと設定が開きます。"
      },
      {
        "target": "shield",
        "eyebrow": "保護",
        "title": "保護されています",
        "body": "Nebula は uBlock Origin Lite で広告とトラッカーを、独自の保護で Cookie バナーをブロックします。サイトが正しく表示されないときは、サイト情報からそのサイトの保護をオフにできます。",
        "action": "操作は必要ありません。"
      }
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
