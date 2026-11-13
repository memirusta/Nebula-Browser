//! What the error page of a failed navigation says, one title and one explanation for each of the failures WebView2 reports,
//! in the nine languages. The explanations differ on purpose: someone who reads "the connection was reset" and "the server can't
//! be reached" should learn that these are different things, not one "can't be reached" for all of them.

/// The failures the page tells apart (see `tab_error_page::error_detail` for which WebView2 status each one is).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorDetail {
    CertificateNameMismatch,
    CertificateExpired,
    CertificateRevoked,
    CertificateInvalid,
    ClientCertificate,
    NameNotResolved,
    TimedOut,
    AuthenticationRequired,
    ProxyAuthenticationRequired,
    InvalidServerResponse,
    RedirectFailed,
    ServerUnreachable,
    CannotConnect,
    ConnectionReset,
    ConnectionAborted,
    Disconnected,
    Unexpected,
}

/// The title and the explanation of a failure in a language (English for a language without a text).
pub fn error_copy(locale: &str, detail: ErrorDetail) -> (&'static str, &'static str) {
    let table: &[(&str, &str); 17] = match locale {
        "tr" => &TR,
        "es" => &ES,
        "de" => &DE,
        "fr" => &FR,
        "id" => &ID,
        "ru" => &RU,
        "it" => &IT,
        "ja" => &JA,
        _ => &EN,
    };
    table[detail as usize]
}

static EN: [(&str, &str); 17] = [
    (
        "Your connection isn't private",
        "The site's security certificate was issued for a different address than the one you opened. The site may be set up incorrectly, or someone may be pretending to be it.",
    ),
    (
        "Your connection isn't private",
        "The site's security certificate has expired. If other sites show this too, check that your computer's date and time are correct.",
    ),
    (
        "Your connection isn't private",
        "The authority that issued the site's security certificate has revoked it, so it can no longer be trusted.",
    ),
    (
        "Your connection isn't private",
        "The site's security certificate is invalid, or it comes from an authority this computer does not trust.",
    ),
    (
        "A certificate is needed",
        "The site asked for a certificate from you, and the one that was offered has errors, so the secure connection could not be set up.",
    ),
    (
        "This site can't be found",
        "The address could not be found: the name does not exist, or your computer could not look it up (DNS). Check it for typing mistakes, then try again.",
    ),
    (
        "The connection timed out",
        "The server did not answer in time. It may be busy or down, or your connection may be slow. Try again in a while.",
    ),
    (
        "Sign-in required",
        "The site wants valid credentials (a user name and password) before it shows this page.",
    ),
    (
        "Proxy sign-in required",
        "The proxy your connection goes through wants valid credentials. Check your proxy or network settings.",
    ),
    (
        "The site sent a reply that can't be used",
        "The server answered in a way the browser could not understand. This is usually a problem on the site's side; try again later.",
    ),
    (
        "The redirect failed",
        "The site tried to send you to another address, but that redirect failed or could not be followed.",
    ),
    (
        "The server can't be reached",
        "No route to the server was found. The server may be down, or a network, firewall or proxy on the way is in the way.",
    ),
    (
        "Couldn't connect to the server",
        "The server refused the connection or is not accepting connections on this address. It may be down; a firewall or antivirus can also block it.",
    ),
    (
        "The connection was reset",
        "The connection was opened, but the server (or something on the way) cut it off before the page finished loading.",
    ),
    (
        "The connection was aborted",
        "The connection was closed before the page finished loading. This can be a program on your computer such as antivirus, an unstable connection, or the site itself.",
    ),
    (
        "You are disconnected",
        "Your computer lost its network connection. Check the cable or Wi-Fi, then try again.",
    ),
    (
        "The page could not be loaded",
        "An unexpected navigation error occurred. Try again.",
    ),
];

static TR: [(&str, &str); 17] = [
    (
        "Bağlantınız gizli değil",
        "Sitenin güvenlik sertifikası, açtığınız adresten farklı bir adres için verilmiş. Site yanlış kurulmuş olabilir ya da biri o siteymiş gibi davranıyor olabilir.",
    ),
    (
        "Bağlantınız gizli değil",
        "Sitenin güvenlik sertifikasının süresi dolmuş. Başka sitelerde de görüyorsanız bilgisayarınızın tarih ve saatinin doğru olduğundan emin olun.",
    ),
    (
        "Bağlantınız gizli değil",
        "Sitenin güvenlik sertifikasını veren kuruluş sertifikayı iptal etmiş, bu yüzden artık güvenilemez.",
    ),
    (
        "Bağlantınız gizli değil",
        "Sitenin güvenlik sertifikası geçersiz ya da bu bilgisayarın güvenmediği bir kuruluştan geliyor.",
    ),
    (
        "Sertifika gerekli",
        "Site sizden bir sertifika istedi ve sunulan sertifikada hatalar var, bu yüzden güvenli bağlantı kurulamadı.",
    ),
    (
        "Site bulunamadı",
        "Adres bulunamadı: böyle bir ad yok ya da bilgisayarınız onu çözemedi (DNS). Yazım hatası olup olmadığına bakıp tekrar deneyin.",
    ),
    (
        "Bağlantı zaman aşımına uğradı",
        "Sunucu zamanında yanıt vermedi. Yoğun ya da kapalı olabilir, bağlantınız da yavaş olabilir. Bir süre sonra tekrar deneyin.",
    ),
    (
        "Oturum açmanız gerekiyor",
        "Site, bu sayfayı göstermeden önce geçerli oturum bilgileri (kullanıcı adı ve parola) istiyor.",
    ),
    (
        "Proxy oturumu gerekli",
        "Bağlantınızın geçtiği proxy geçerli oturum bilgileri istiyor. Proxy ya da ağ ayarlarınızı kontrol edin.",
    ),
    (
        "Site kullanılamayan bir yanıt gönderdi",
        "Sunucu, tarayıcının anlayamadığı bir yanıt verdi. Bu çoğunlukla sitenin kendi tarafındaki bir sorundur; bir süre sonra tekrar deneyin.",
    ),
    (
        "Yönlendirme başarısız oldu",
        "Site sizi başka bir adrese göndermeye çalıştı ama bu yönlendirme başarısız oldu ya da izlenemedi.",
    ),
    (
        "Sunucuya ulaşılamıyor",
        "Sunucuya giden bir yol bulunamadı. Sunucu kapalı olabilir ya da yoldaki bir ağ, güvenlik duvarı ya da proxy engelliyor olabilir.",
    ),
    (
        "Sunucuya bağlanılamadı",
        "Sunucu bağlantıyı reddetti ya da bu adreste bağlantı kabul etmiyor. Kapalı olabilir; güvenlik duvarı ya da antivirüs de engelliyor olabilir.",
    ),
    (
        "Bağlantı sıfırlandı",
        "Bağlantı kuruldu ama sayfa yüklenmeden önce sunucu (ya da yoldaki bir şey) bağlantıyı kesti.",
    ),
    (
        "Bağlantı yarıda kesildi",
        "Sayfa yüklenmeden bağlantı kapatıldı. Bilgisayarınızdaki antivirüs gibi bir program, kararsız bir bağlantı ya da sitenin kendisi sebep olabilir.",
    ),
    (
        "Ağ bağlantınız yok",
        "Bilgisayarınız ağ bağlantısını kaybetti. Kabloyu ya da Wi-Fi'yi kontrol edip tekrar deneyin.",
    ),
    (
        "Sayfa yüklenemedi",
        "Beklenmeyen bir gezinme hatası oluştu. Tekrar deneyin.",
    ),
];

static ES: [(&str, &str); 17] = [
    (
        "La conexión no es privada",
        "El certificado de seguridad del sitio se emitió para una dirección distinta de la que abriste. El sitio puede estar mal configurado o alguien puede estar suplantándolo.",
    ),
    (
        "La conexión no es privada",
        "El certificado de seguridad del sitio ha caducado. Si otros sitios también lo muestran, comprueba que la fecha y la hora del equipo sean correctas.",
    ),
    (
        "La conexión no es privada",
        "La entidad que emitió el certificado de seguridad del sitio lo ha revocado, así que ya no es de fiar.",
    ),
    (
        "La conexión no es privada",
        "El certificado de seguridad del sitio no es válido o procede de una entidad en la que este equipo no confía.",
    ),
    (
        "Se necesita un certificado",
        "El sitio pidió un certificado tuyo y el que se ofreció tiene errores, así que no se pudo establecer la conexión segura.",
    ),
    (
        "No se encuentra este sitio",
        "No se encontró la dirección: el nombre no existe o tu equipo no pudo resolverlo (DNS). Comprueba que no tenga errores y vuelve a intentarlo.",
    ),
    (
        "Se agotó el tiempo de conexión",
        "El servidor no respondió a tiempo. Puede estar saturado o caído, o tu conexión puede ser lenta. Inténtalo de nuevo más tarde.",
    ),
    (
        "Se requiere iniciar sesión",
        "El sitio pide credenciales válidas (usuario y contraseña) antes de mostrar esta página.",
    ),
    (
        "Se requiere iniciar sesión en el proxy",
        "El proxy por el que pasa tu conexión pide credenciales válidas. Revisa la configuración del proxy o de la red.",
    ),
    (
        "El sitio envió una respuesta inutilizable",
        "El servidor respondió de una forma que el navegador no pudo entender. Suele ser un problema del propio sitio; inténtalo más tarde.",
    ),
    (
        "Falló la redirección",
        "El sitio intentó llevarte a otra dirección, pero la redirección falló o no se pudo seguir.",
    ),
    (
        "No se puede acceder al servidor",
        "No se encontró ninguna ruta hasta el servidor. Puede estar caído, o una red, un cortafuegos o un proxy del camino lo impide.",
    ),
    (
        "No se pudo conectar con el servidor",
        "El servidor rechazó la conexión o no acepta conexiones en esta dirección. Puede estar caído; un cortafuegos o el antivirus también pueden bloquearla.",
    ),
    (
        "Se restableció la conexión",
        "La conexión se abrió, pero el servidor (o algo en el camino) la cortó antes de que terminara de cargar la página.",
    ),
    (
        "Se interrumpió la conexión",
        "La conexión se cerró antes de que terminara de cargar la página. Puede deberse a un programa de tu equipo, como el antivirus, a una conexión inestable o al propio sitio.",
    ),
    (
        "Estás desconectado",
        "Tu equipo perdió la conexión de red. Revisa el cable o el Wi-Fi y vuelve a intentarlo.",
    ),
    (
        "No se pudo cargar la página",
        "Se produjo un error de navegación inesperado. Inténtalo de nuevo.",
    ),
];

static DE: [(&str, &str); 17] = [
    (
        "Die Verbindung ist nicht privat",
        "Das Sicherheitszertifikat der Website wurde für eine andere Adresse ausgestellt als die, die du geöffnet hast. Die Website ist möglicherweise falsch eingerichtet, oder jemand gibt sich als sie aus.",
    ),
    (
        "Die Verbindung ist nicht privat",
        "Das Sicherheitszertifikat der Website ist abgelaufen. Wenn auch andere Websites das zeigen, prüfe Datum und Uhrzeit deines Computers.",
    ),
    (
        "Die Verbindung ist nicht privat",
        "Die Stelle, die das Sicherheitszertifikat der Website ausgestellt hat, hat es widerrufen. Ihm kann nicht mehr vertraut werden.",
    ),
    (
        "Die Verbindung ist nicht privat",
        "Das Sicherheitszertifikat der Website ist ungültig oder stammt von einer Stelle, der dieser Computer nicht vertraut.",
    ),
    (
        "Ein Zertifikat wird benötigt",
        "Die Website hat ein Zertifikat von dir verlangt, und das angebotene ist fehlerhaft. Die sichere Verbindung konnte nicht aufgebaut werden.",
    ),
    (
        "Diese Website wurde nicht gefunden",
        "Die Adresse wurde nicht gefunden: Der Name existiert nicht oder dein Computer konnte ihn nicht auflösen (DNS). Prüfe sie auf Tippfehler und versuche es erneut.",
    ),
    (
        "Zeitüberschreitung bei der Verbindung",
        "Der Server hat nicht rechtzeitig geantwortet. Er ist vielleicht überlastet oder nicht erreichbar, oder deine Verbindung ist langsam. Versuche es später erneut.",
    ),
    (
        "Anmeldung erforderlich",
        "Die Website verlangt gültige Zugangsdaten (Benutzername und Passwort), bevor sie diese Seite zeigt.",
    ),
    (
        "Proxy-Anmeldung erforderlich",
        "Der Proxy, über den deine Verbindung läuft, verlangt gültige Zugangsdaten. Prüfe die Proxy- oder Netzwerkeinstellungen.",
    ),
    (
        "Die Website hat eine unbrauchbare Antwort gesendet",
        "Der Server hat so geantwortet, dass der Browser es nicht verstehen konnte. Meist liegt das Problem bei der Website selbst; versuche es später erneut.",
    ),
    (
        "Die Weiterleitung ist fehlgeschlagen",
        "Die Website wollte dich an eine andere Adresse weiterleiten, doch das ist fehlgeschlagen oder ließ sich nicht verfolgen.",
    ),
    (
        "Der Server ist nicht erreichbar",
        "Es wurde kein Weg zum Server gefunden. Er ist vielleicht ausgefallen, oder ein Netzwerk, eine Firewall oder ein Proxy auf dem Weg blockiert ihn.",
    ),
    (
        "Verbindung zum Server nicht möglich",
        "Der Server hat die Verbindung abgelehnt oder nimmt unter dieser Adresse keine Verbindungen an. Er ist vielleicht ausgefallen; auch eine Firewall oder ein Virenscanner kann blockieren.",
    ),
    (
        "Die Verbindung wurde zurückgesetzt",
        "Die Verbindung wurde aufgebaut, doch der Server (oder etwas auf dem Weg) hat sie getrennt, bevor die Seite fertig geladen war.",
    ),
    (
        "Die Verbindung wurde abgebrochen",
        "Die Verbindung wurde geschlossen, bevor die Seite fertig geladen war. Ursache kann ein Programm auf deinem Computer wie ein Virenscanner, eine instabile Verbindung oder die Website selbst sein.",
    ),
    (
        "Du bist nicht verbunden",
        "Dein Computer hat die Netzwerkverbindung verloren. Prüfe das Kabel oder das WLAN und versuche es erneut.",
    ),
    (
        "Die Seite konnte nicht geladen werden",
        "Es ist ein unerwarteter Navigationsfehler aufgetreten. Versuche es erneut.",
    ),
];

static FR: [(&str, &str); 17] = [
    (
        "La connexion n’est pas privée",
        "Le certificat de sécurité du site a été émis pour une autre adresse que celle que vous avez ouverte. Le site est peut-être mal configuré, ou quelqu’un se fait passer pour lui.",
    ),
    (
        "La connexion n’est pas privée",
        "Le certificat de sécurité du site a expiré. Si d’autres sites affichent la même chose, vérifiez la date et l’heure de votre ordinateur.",
    ),
    (
        "La connexion n’est pas privée",
        "L’autorité qui a émis le certificat de sécurité du site l’a révoqué : il n’est plus digne de confiance.",
    ),
    (
        "La connexion n’est pas privée",
        "Le certificat de sécurité du site est invalide ou provient d’une autorité à laquelle cet ordinateur ne fait pas confiance.",
    ),
    (
        "Un certificat est nécessaire",
        "Le site a demandé un certificat et celui qui a été proposé comporte des erreurs ; la connexion sécurisée n’a donc pas pu être établie.",
    ),
    (
        "Ce site est introuvable",
        "L’adresse est introuvable : le nom n’existe pas ou votre ordinateur n’a pas pu le résoudre (DNS). Vérifiez qu’il ne contient pas de faute de frappe, puis réessayez.",
    ),
    (
        "Délai de connexion dépassé",
        "Le serveur n’a pas répondu à temps. Il est peut-être surchargé ou hors service, ou votre connexion est lente. Réessayez un peu plus tard.",
    ),
    (
        "Connexion requise",
        "Le site demande des identifiants valides (nom d’utilisateur et mot de passe) avant d’afficher cette page.",
    ),
    (
        "Connexion au proxy requise",
        "Le proxy par lequel passe votre connexion demande des identifiants valides. Vérifiez les paramètres du proxy ou du réseau.",
    ),
    (
        "Le site a envoyé une réponse inutilisable",
        "Le serveur a répondu d’une façon que le navigateur n’a pas pu comprendre. Le problème vient généralement du site ; réessayez plus tard.",
    ),
    (
        "La redirection a échoué",
        "Le site a essayé de vous envoyer vers une autre adresse, mais la redirection a échoué ou n’a pas pu être suivie.",
    ),
    (
        "Le serveur est inaccessible",
        "Aucun chemin vers le serveur n’a été trouvé. Il est peut-être hors service, ou un réseau, un pare-feu ou un proxy sur le trajet le bloque.",
    ),
    (
        "Impossible de se connecter au serveur",
        "Le serveur a refusé la connexion ou n’accepte pas de connexions à cette adresse. Il est peut-être hors service ; un pare-feu ou un antivirus peut aussi la bloquer.",
    ),
    (
        "La connexion a été réinitialisée",
        "La connexion a été ouverte, mais le serveur (ou quelque chose sur le trajet) l’a coupée avant la fin du chargement de la page.",
    ),
    (
        "La connexion a été interrompue",
        "La connexion a été fermée avant la fin du chargement de la page. La cause peut être un programme de votre ordinateur comme un antivirus, une connexion instable ou le site lui-même.",
    ),
    (
        "Vous êtes déconnecté",
        "Votre ordinateur a perdu sa connexion réseau. Vérifiez le câble ou le Wi-Fi, puis réessayez.",
    ),
    (
        "La page n’a pas pu être chargée",
        "Une erreur de navigation inattendue s’est produite. Réessayez.",
    ),
];

static ID: [(&str, &str); 17] = [
    (
        "Koneksi tidak pribadi",
        "Sertifikat keamanan situs diterbitkan untuk alamat yang berbeda dari yang Anda buka. Situs mungkin salah dikonfigurasi, atau ada pihak yang menyamar sebagai situs itu.",
    ),
    (
        "Koneksi tidak pribadi",
        "Sertifikat keamanan situs telah kedaluwarsa. Jika situs lain juga menampilkannya, periksa tanggal dan jam komputer Anda.",
    ),
    (
        "Koneksi tidak pribadi",
        "Otoritas yang menerbitkan sertifikat keamanan situs telah mencabutnya, sehingga tidak lagi dapat dipercaya.",
    ),
    (
        "Koneksi tidak pribadi",
        "Sertifikat keamanan situs tidak valid atau berasal dari otoritas yang tidak dipercaya komputer ini.",
    ),
    (
        "Sertifikat diperlukan",
        "Situs meminta sertifikat dari Anda, dan sertifikat yang diberikan memiliki kesalahan sehingga koneksi aman tidak dapat dibuat.",
    ),
    (
        "Situs ini tidak ditemukan",
        "Alamat tidak ditemukan: nama tidak ada, atau komputer Anda tidak dapat menelusurinya (DNS). Periksa kesalahan pengetikan lalu coba lagi.",
    ),
    (
        "Koneksi kehabisan waktu",
        "Server tidak menjawab tepat waktu. Server mungkin sibuk atau mati, atau koneksi Anda lambat. Coba lagi nanti.",
    ),
    (
        "Perlu masuk",
        "Situs meminta kredensial yang valid (nama pengguna dan kata sandi) sebelum menampilkan halaman ini.",
    ),
    (
        "Perlu masuk ke proxy",
        "Proxy yang dilalui koneksi Anda meminta kredensial yang valid. Periksa pengaturan proxy atau jaringan Anda.",
    ),
    (
        "Situs mengirim balasan yang tidak dapat dipakai",
        "Server menjawab dengan cara yang tidak dapat dipahami peramban. Biasanya masalah ada di sisi situs; coba lagi nanti.",
    ),
    (
        "Pengalihan gagal",
        "Situs mencoba mengarahkan Anda ke alamat lain, tetapi pengalihan itu gagal atau tidak dapat diikuti.",
    ),
    (
        "Server tidak dapat dijangkau",
        "Tidak ditemukan jalur ke server. Server mungkin mati, atau jaringan, firewall, atau proxy di jalur menghalanginya.",
    ),
    (
        "Tidak dapat tersambung ke server",
        "Server menolak koneksi atau tidak menerima koneksi pada alamat ini. Server mungkin mati; firewall atau antivirus juga dapat memblokirnya.",
    ),
    (
        "Koneksi direset",
        "Koneksi sempat terbuka, tetapi server (atau sesuatu di jalur) memutuskannya sebelum halaman selesai dimuat.",
    ),
    (
        "Koneksi dibatalkan",
        "Koneksi ditutup sebelum halaman selesai dimuat. Penyebabnya bisa program di komputer Anda seperti antivirus, koneksi yang tidak stabil, atau situs itu sendiri.",
    ),
    (
        "Anda tidak terhubung",
        "Komputer Anda kehilangan koneksi jaringan. Periksa kabel atau Wi-Fi, lalu coba lagi.",
    ),
    (
        "Halaman tidak dapat dimuat",
        "Terjadi kesalahan navigasi yang tidak terduga. Coba lagi.",
    ),
];

static RU: [(&str, &str); 17] = [
    (
        "Подключение не защищено",
        "Сертификат безопасности сайта выдан для другого адреса, не того, который вы открыли. Сайт мог быть настроен неправильно, либо кто-то выдаёт себя за него.",
    ),
    (
        "Подключение не защищено",
        "Срок действия сертификата безопасности сайта истёк. Если то же самое видно и на других сайтах, проверьте дату и время на компьютере.",
    ),
    (
        "Подключение не защищено",
        "Центр, выдавший сертификат безопасности сайта, отозвал его, поэтому ему больше нельзя доверять.",
    ),
    (
        "Подключение не защищено",
        "Сертификат безопасности сайта недействителен или выдан центром, которому этот компьютер не доверяет.",
    ),
    (
        "Нужен сертификат",
        "Сайт запросил у вас сертификат, а предложенный содержит ошибки, поэтому защищённое соединение не удалось установить.",
    ),
    (
        "Сайт не найден",
        "Адрес не найден: такого имени нет, либо компьютер не смог его определить (DNS). Проверьте, нет ли опечаток, и повторите попытку.",
    ),
    (
        "Время ожидания истекло",
        "Сервер не ответил вовремя. Он может быть перегружен или недоступен, либо у вас медленное соединение. Повторите попытку позже.",
    ),
    (
        "Требуется вход",
        "Сайт требует действительные учётные данные (имя пользователя и пароль), прежде чем показать эту страницу.",
    ),
    (
        "Требуется вход в прокси",
        "Прокси, через который идёт ваше соединение, требует действительные учётные данные. Проверьте настройки прокси или сети.",
    ),
    (
        "Сайт прислал непригодный ответ",
        "Сервер ответил так, что браузер не смог его понять. Обычно проблема на стороне сайта; повторите попытку позже.",
    ),
    (
        "Не удалось выполнить перенаправление",
        "Сайт попытался отправить вас на другой адрес, но перенаправление не удалось или не может быть выполнено.",
    ),
    (
        "Сервер недоступен",
        "Путь к серверу не найден. Сервер может быть выключен, либо ему мешает сеть, брандмауэр или прокси на пути.",
    ),
    (
        "Не удалось подключиться к серверу",
        "Сервер отклонил соединение или не принимает подключения по этому адресу. Он может быть выключен; блокировать могут также брандмауэр или антивирус.",
    ),
    (
        "Соединение было сброшено",
        "Соединение было установлено, но сервер (или что-то на пути) оборвал его до окончания загрузки страницы.",
    ),
    (
        "Соединение прервано",
        "Соединение закрылось до окончания загрузки страницы. Причиной может быть программа на вашем компьютере, например антивирус, нестабильное соединение или сам сайт.",
    ),
    (
        "Нет подключения к сети",
        "Компьютер потерял сетевое соединение. Проверьте кабель или Wi-Fi и повторите попытку.",
    ),
    (
        "Не удалось загрузить страницу",
        "Произошла непредвиденная ошибка перехода. Повторите попытку.",
    ),
];

static IT: [(&str, &str); 17] = [
    (
        "La connessione non è privata",
        "Il certificato di sicurezza del sito è stato emesso per un indirizzo diverso da quello che hai aperto. Il sito potrebbe essere configurato male, oppure qualcuno si sta spacciando per esso.",
    ),
    (
        "La connessione non è privata",
        "Il certificato di sicurezza del sito è scaduto. Se lo mostrano anche altri siti, controlla che data e ora del computer siano corrette.",
    ),
    (
        "La connessione non è privata",
        "L’autorità che ha emesso il certificato di sicurezza del sito lo ha revocato, quindi non è più affidabile.",
    ),
    (
        "La connessione non è privata",
        "Il certificato di sicurezza del sito non è valido oppure proviene da un’autorità di cui questo computer non si fida.",
    ),
    (
        "Serve un certificato",
        "Il sito ha richiesto un certificato da parte tua e quello offerto contiene errori, quindi non è stato possibile stabilire la connessione sicura.",
    ),
    (
        "Impossibile trovare questo sito",
        "L’indirizzo non è stato trovato: il nome non esiste oppure il computer non è riuscito a risolverlo (DNS). Controlla che non ci siano errori di battitura e riprova.",
    ),
    (
        "Connessione scaduta",
        "Il server non ha risposto in tempo. Potrebbe essere sovraccarico o non disponibile, oppure la tua connessione è lenta. Riprova più tardi.",
    ),
    (
        "Accesso richiesto",
        "Il sito richiede credenziali valide (nome utente e password) prima di mostrare questa pagina.",
    ),
    (
        "Accesso al proxy richiesto",
        "Il proxy attraverso cui passa la tua connessione richiede credenziali valide. Controlla le impostazioni del proxy o della rete.",
    ),
    (
        "Il sito ha inviato una risposta inutilizzabile",
        "Il server ha risposto in un modo che il browser non è riuscito a capire. Di solito il problema è del sito; riprova più tardi.",
    ),
    (
        "Reindirizzamento non riuscito",
        "Il sito ha provato a mandarti a un altro indirizzo, ma il reindirizzamento non è riuscito o non è stato possibile seguirlo.",
    ),
    (
        "Il server non è raggiungibile",
        "Non è stato trovato alcun percorso verso il server. Potrebbe essere fuori servizio, oppure una rete, un firewall o un proxy lungo il percorso lo impedisce.",
    ),
    (
        "Impossibile connettersi al server",
        "Il server ha rifiutato la connessione o non accetta connessioni a questo indirizzo. Potrebbe essere fuori servizio; anche un firewall o un antivirus può bloccarla.",
    ),
    (
        "La connessione è stata reimpostata",
        "La connessione è stata aperta, ma il server (o qualcosa lungo il percorso) l’ha interrotta prima che la pagina finisse di caricarsi.",
    ),
    (
        "La connessione è stata interrotta",
        "La connessione è stata chiusa prima che la pagina finisse di caricarsi. La causa può essere un programma del computer come un antivirus, una connessione instabile o il sito stesso.",
    ),
    (
        "Non sei connesso",
        "Il computer ha perso la connessione di rete. Controlla il cavo o il Wi-Fi e riprova.",
    ),
    (
        "Impossibile caricare la pagina",
        "Si è verificato un errore di navigazione imprevisto. Riprova.",
    ),
];

static JA: [(&str, &str); 17] = [
    (
        "接続はプライベートではありません",
        "このサイトのセキュリティ証明書は、開いたアドレスとは別のアドレス用に発行されています。サイトの設定が誤っているか、何者かがサイトになりすましている可能性があります。",
    ),
    (
        "接続はプライベートではありません",
        "このサイトのセキュリティ証明書の有効期限が切れています。他のサイトでも同じ表示になる場合は、パソコンの日付と時刻が正しいか確認してください。",
    ),
    (
        "接続はプライベートではありません",
        "このサイトのセキュリティ証明書を発行した機関が証明書を失効させたため、信頼できません。",
    ),
    (
        "接続はプライベートではありません",
        "このサイトのセキュリティ証明書が無効か、このパソコンが信頼していない機関から発行されています。",
    ),
    (
        "証明書が必要です",
        "サイトがあなたの証明書を求めましたが、提示された証明書にエラーがあるため、安全な接続を確立できませんでした。",
    ),
    (
        "サイトが見つかりません",
        "アドレスが見つかりません。その名前が存在しないか、パソコンが名前を解決できませんでした（DNS）。入力ミスがないか確認して、もう一度お試しください。",
    ),
    (
        "接続がタイムアウトしました",
        "サーバーが時間内に応答しませんでした。混雑または停止しているか、接続が遅い可能性があります。しばらくしてからもう一度お試しください。",
    ),
    (
        "サインインが必要です",
        "このページを表示する前に、サイトが有効な認証情報（ユーザー名とパスワード）を求めています。",
    ),
    (
        "プロキシへのサインインが必要です",
        "接続が通るプロキシが有効な認証情報を求めています。プロキシまたはネットワークの設定を確認してください。",
    ),
    (
        "サイトが使えない応答を返しました",
        "サーバーの応答をブラウザーが理解できませんでした。多くの場合はサイト側の問題です。しばらくしてからもう一度お試しください。",
    ),
    (
        "リダイレクトに失敗しました",
        "サイトが別のアドレスへ移動させようとしましたが、リダイレクトに失敗したか、たどれませんでした。",
    ),
    (
        "サーバーに到達できません",
        "サーバーへの経路が見つかりませんでした。サーバーが停止しているか、経路上のネットワーク、ファイアウォール、プロキシが妨げている可能性があります。",
    ),
    (
        "サーバーに接続できませんでした",
        "サーバーが接続を拒否したか、このアドレスで接続を受け付けていません。停止している可能性があります。ファイアウォールやウイルス対策ソフトが遮断していることもあります。",
    ),
    (
        "接続がリセットされました",
        "接続は開始されましたが、ページの読み込みが終わる前にサーバー（または経路上の何か）が切断しました。",
    ),
    (
        "接続が中断されました",
        "ページの読み込みが終わる前に接続が閉じられました。ウイルス対策ソフトなどパソコン上のプログラム、不安定な接続、またはサイト自体が原因の可能性があります。",
    ),
    (
        "ネットワークに接続されていません",
        "パソコンがネットワーク接続を失いました。ケーブルまたは Wi-Fi を確認して、もう一度お試しください。",
    ),
    (
        "ページを読み込めませんでした",
        "予期しない移動エラーが発生しました。もう一度お試しください。",
    ),
];

#[cfg(test)]
mod tests {
    use super::{error_copy, ErrorDetail};

    const LOCALES: [&str; 9] = ["en", "tr", "es", "de", "fr", "id", "ru", "it", "ja"];
    const ALL: [ErrorDetail; 17] = [
        ErrorDetail::CertificateNameMismatch,
        ErrorDetail::CertificateExpired,
        ErrorDetail::CertificateRevoked,
        ErrorDetail::CertificateInvalid,
        ErrorDetail::ClientCertificate,
        ErrorDetail::NameNotResolved,
        ErrorDetail::TimedOut,
        ErrorDetail::AuthenticationRequired,
        ErrorDetail::ProxyAuthenticationRequired,
        ErrorDetail::InvalidServerResponse,
        ErrorDetail::RedirectFailed,
        ErrorDetail::ServerUnreachable,
        ErrorDetail::CannotConnect,
        ErrorDetail::ConnectionReset,
        ErrorDetail::ConnectionAborted,
        ErrorDetail::Disconnected,
        ErrorDetail::Unexpected,
    ];

    #[test]
    fn every_failure_has_a_title_and_an_explanation_in_every_language() {
        for locale in LOCALES {
            for detail in ALL {
                let (title, description) = error_copy(locale, detail);
                assert!(
                    !title.is_empty() && !description.is_empty(),
                    "{locale} {detail:?}"
                );
                assert!(!title.contains("COREWEBVIEW2"), "{locale} {detail:?}");
            }
        }
    }

    #[test]
    fn the_explanations_differ_so_that_the_person_can_tell_the_failures_apart() {
        for locale in LOCALES {
            let mut seen = std::collections::HashSet::new();
            for detail in ALL {
                assert!(
                    seen.insert(error_copy(locale, detail).1),
                    "{locale}: {detail:?} says what another failure says"
                );
            }
            // The failures of the connection itself also have titles of their own.
            let titles: std::collections::HashSet<_> = [
                ErrorDetail::ServerUnreachable,
                ErrorDetail::CannotConnect,
                ErrorDetail::ConnectionReset,
                ErrorDetail::ConnectionAborted,
                ErrorDetail::Disconnected,
                ErrorDetail::TimedOut,
                ErrorDetail::NameNotResolved,
            ]
            .into_iter()
            .map(|detail| error_copy(locale, detail).0)
            .collect();
            assert_eq!(titles.len(), 7, "{locale}");
        }
    }

    #[test]
    fn a_language_without_a_text_falls_back_to_english() {
        assert_eq!(
            error_copy("xx", ErrorDetail::ConnectionReset),
            error_copy("en", ErrorDetail::ConnectionReset)
        );
    }
}
