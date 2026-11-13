/**
 * A failed import of passwords from a browser says why with a code, `nebula-import:<code>[:<detail>...]`, and this puts
 * it in words in the person's language. A failure with no code (a database error, a locked file's own message) is not
 * described here: the caller shows its general message with the detail next to it.
 *
 * Kept free of imports so tests can read it as it is.
 */

export type PasswordImportErrorCode =
  | 'database-missing'
  | 'login-data-missing'
  | 'unreadable'
  | 'app-bound-all'
  | 'app-bound-some'
  | 'undecryptable'
  | 'copy-failed'
  | 'key-unavailable'

const PREFIX = 'nebula-import:'

const CODES: readonly PasswordImportErrorCode[] = [
  'database-missing',
  'login-data-missing',
  'unreadable',
  'app-bound-all',
  'app-bound-some',
  'undecryptable',
  'copy-failed',
  'key-unavailable',
]

/** The codes that end in "use the browser's CSV export instead". */
const NEEDS_CSV: readonly PasswordImportErrorCode[] = ['unreadable', 'app-bound-all', 'app-bound-some', 'undecryptable']

export interface PasswordImportFailure {
  code: PasswordImportErrorCode
  /** What followed the code: a count, the browser, the system's own message. */
  details: string[]
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : ''
}

export function parsePasswordImportError(error: unknown): PasswordImportFailure | null {
  const message = messageOf(error)
  if (!message.startsWith(PREFIX)) return null
  const [code, ...details] = message.slice(PREFIX.length).split(':')
  return (CODES as readonly string[]).includes(code) ? { code: code as PasswordImportErrorCode, details } : null
}

export function passwordImportNeedsCsv(error: unknown): boolean {
  const failure = parsePasswordImportError(error)
  return failure !== null && NEEDS_CSV.includes(failure.code)
}

type Copy = Record<PasswordImportErrorCode, string>

/** {count}, {skipped} and {detail} are filled in from what followed the code. */
const COPY: Record<string, Copy> = {
  en: {
    'database-missing': 'No password database was found for this browser.',
    'login-data-missing': "The browser's password file (Login Data) was not found.",
    unreadable:
      "The browser shows saved passwords, but they could not be read from its file. Export them as CSV from the browser's password manager and use the CSV import here.",
    'app-bound-all':
      "{count} saved passwords were found, but the browser's newer app-bound encryption cannot be opened from outside. Export them as CSV from the browser's passwords page and use the CSV import here.",
    'app-bound-some':
      '{skipped} of {count} entries use the newer app-bound encryption and cannot be imported. Try the CSV export for the rest.',
    undecryptable:
      '{count} saved passwords were found but could not be decrypted. It may be another Windows user or a damaged database; try the CSV export.',
    'copy-failed':
      "The password database could not be copied. It may be locked while the browser is open: close the browser and try again. ({detail})",
    'key-unavailable': "The browser's encryption key could not be read. ({detail})",
  },
  tr: {
    'database-missing': 'Bu tarayıcı için şifre veritabanı bulunamadı.',
    'login-data-missing': 'Tarayıcının şifre dosyası (Login Data) bulunamadı.',
    unreadable:
      "Tarayıcıda şifre görünüyor ama dosyadan okunamadı. Tarayıcının şifre yöneticisinden CSV olarak dışa aktar ve buradaki CSV içe aktarmayı kullan.",
    'app-bound-all':
      "{count} şifre kaydı var ama tarayıcının yeni app-bound şifrelemesi dışarıdan açılamıyor. Tarayıcıda şifreler sayfasından CSV olarak dışa aktarıp buradan CSV içe aktarmayı kullan.",
    'app-bound-some':
      "{count} kayıttan {skipped} tanesi yeni app-bound şifrelemede; dışarıdan aktarılamıyor. Kalanlar için CSV dışa aktarmayı dene.",
    undecryptable:
      "{count} şifre kaydı var ama çözülemedi. Farklı bir Windows kullanıcısı veya bozuk veritabanı olabilir; CSV dışa aktarmayı dene.",
    'copy-failed':
      'Şifre veritabanı kopyalanamadı. Tarayıcı açıkken kilitli olabilir: tarayıcıyı kapatıp tekrar dene. ({detail})',
    'key-unavailable': 'Tarayıcının şifreleme anahtarı okunamadı. ({detail})',
  },
  es: {
    'database-missing': 'No se encontró la base de datos de contraseñas de este navegador.',
    'login-data-missing': 'No se encontró el archivo de contraseñas del navegador (Login Data).',
    unreadable:
      'El navegador muestra contraseñas guardadas, pero no se pudieron leer de su archivo. Expórtalas como CSV desde el administrador de contraseñas del navegador y usa aquí la importación de CSV.',
    'app-bound-all':
      'Se encontraron {count} contraseñas guardadas, pero el cifrado app-bound más reciente del navegador no se puede abrir desde fuera. Expórtalas como CSV desde la página de contraseñas del navegador y usa aquí la importación de CSV.',
    'app-bound-some':
      '{skipped} de {count} entradas usan el cifrado app-bound más reciente y no se pueden importar. Prueba la exportación CSV para el resto.',
    undecryptable:
      'Se encontraron {count} contraseñas guardadas, pero no se pudieron descifrar. Puede ser otro usuario de Windows o una base de datos dañada; prueba la exportación CSV.',
    'copy-failed':
      'No se pudo copiar la base de datos de contraseñas. Puede estar bloqueada mientras el navegador está abierto: ciérralo e inténtalo de nuevo. ({detail})',
    'key-unavailable': 'No se pudo leer la clave de cifrado del navegador. ({detail})',
  },
  de: {
    'database-missing': 'Für diesen Browser wurde keine Passwortdatenbank gefunden.',
    'login-data-missing': 'Die Passwortdatei des Browsers (Login Data) wurde nicht gefunden.',
    unreadable:
      'Der Browser zeigt gespeicherte Passwörter an, aber sie konnten nicht aus seiner Datei gelesen werden. Exportiere sie als CSV aus der Passwortverwaltung des Browsers und nutze hier den CSV-Import.',
    'app-bound-all':
      '{count} gespeicherte Passwörter wurden gefunden, aber die neuere App-Bound-Verschlüsselung des Browsers lässt sich von außen nicht öffnen. Exportiere sie als CSV von der Passwortseite des Browsers und nutze hier den CSV-Import.',
    'app-bound-some':
      '{skipped} von {count} Einträgen nutzen die neuere App-Bound-Verschlüsselung und lassen sich nicht importieren. Versuche für den Rest den CSV-Export.',
    undecryptable:
      '{count} gespeicherte Passwörter wurden gefunden, ließen sich aber nicht entschlüsseln. Möglicherweise ein anderer Windows-Benutzer oder eine beschädigte Datenbank; versuche den CSV-Export.',
    'copy-failed':
      'Die Passwortdatenbank konnte nicht kopiert werden. Sie ist möglicherweise gesperrt, solange der Browser geöffnet ist: schließe den Browser und versuche es erneut. ({detail})',
    'key-unavailable': 'Der Verschlüsselungsschlüssel des Browsers konnte nicht gelesen werden. ({detail})',
  },
  fr: {
    'database-missing': "Aucune base de mots de passe n'a été trouvée pour ce navigateur.",
    'login-data-missing': "Le fichier de mots de passe du navigateur (Login Data) est introuvable.",
    unreadable:
      "Le navigateur affiche des mots de passe enregistrés, mais ils n'ont pas pu être lus dans son fichier. Exportez-les en CSV depuis le gestionnaire de mots de passe du navigateur et utilisez ici l'import CSV.",
    'app-bound-all':
      "{count} mots de passe enregistrés ont été trouvés, mais le chiffrement app-bound plus récent du navigateur ne peut pas être ouvert de l'extérieur. Exportez-les en CSV depuis la page des mots de passe du navigateur et utilisez ici l'import CSV.",
    'app-bound-some':
      "{skipped} entrées sur {count} utilisent le chiffrement app-bound plus récent et ne peuvent pas être importées. Essayez l'export CSV pour le reste.",
    undecryptable:
      "{count} mots de passe enregistrés ont été trouvés mais n'ont pas pu être déchiffrés. Il peut s'agir d'un autre utilisateur Windows ou d'une base endommagée ; essayez l'export CSV.",
    'copy-failed':
      "La base de mots de passe n'a pas pu être copiée. Elle est peut-être verrouillée tant que le navigateur est ouvert : fermez-le et réessayez. ({detail})",
    'key-unavailable': "La clé de chiffrement du navigateur n'a pas pu être lue. ({detail})",
  },
  id: {
    'database-missing': 'Basis data kata sandi untuk peramban ini tidak ditemukan.',
    'login-data-missing': 'File kata sandi peramban (Login Data) tidak ditemukan.',
    unreadable:
      'Peramban menampilkan kata sandi tersimpan, tetapi tidak dapat dibaca dari filenya. Ekspor sebagai CSV dari pengelola kata sandi peramban dan gunakan impor CSV di sini.',
    'app-bound-all':
      '{count} kata sandi tersimpan ditemukan, tetapi enkripsi app-bound yang lebih baru dari peramban tidak dapat dibuka dari luar. Ekspor sebagai CSV dari halaman kata sandi peramban dan gunakan impor CSV di sini.',
    'app-bound-some':
      '{skipped} dari {count} entri memakai enkripsi app-bound yang lebih baru dan tidak dapat diimpor. Coba ekspor CSV untuk sisanya.',
    undecryptable:
      '{count} kata sandi tersimpan ditemukan tetapi tidak dapat didekripsi. Mungkin pengguna Windows lain atau basis data rusak; coba ekspor CSV.',
    'copy-failed':
      'Basis data kata sandi tidak dapat disalin. Mungkin terkunci saat peramban terbuka: tutup peramban lalu coba lagi. ({detail})',
    'key-unavailable': 'Kunci enkripsi peramban tidak dapat dibaca. ({detail})',
  },
  ru: {
    'database-missing': 'База паролей для этого браузера не найдена.',
    'login-data-missing': 'Файл паролей браузера (Login Data) не найден.',
    unreadable:
      'Браузер показывает сохранённые пароли, но прочитать их из файла не удалось. Экспортируйте их в CSV из менеджера паролей браузера и воспользуйтесь здесь импортом CSV.',
    'app-bound-all':
      'Найдено сохранённых паролей: {count}, но новое шифрование app-bound браузера нельзя открыть снаружи. Экспортируйте их в CSV со страницы паролей браузера и воспользуйтесь здесь импортом CSV.',
    'app-bound-some':
      '{skipped} из {count} записей используют новое шифрование app-bound и не могут быть импортированы. Для остальных попробуйте экспорт CSV.',
    undecryptable:
      'Найдено сохранённых паролей: {count}, но расшифровать их не удалось. Возможно, это другой пользователь Windows или повреждённая база; попробуйте экспорт CSV.',
    'copy-failed':
      'Не удалось скопировать базу паролей. Возможно, она заблокирована, пока браузер открыт: закройте браузер и повторите попытку. ({detail})',
    'key-unavailable': 'Не удалось прочитать ключ шифрования браузера. ({detail})',
  },
  it: {
    'database-missing': 'Non è stato trovato il database delle password di questo browser.',
    'login-data-missing': 'Il file delle password del browser (Login Data) non è stato trovato.',
    unreadable:
      'Il browser mostra password salvate, ma non è stato possibile leggerle dal suo file. Esportale in CSV dal gestore password del browser e usa qui l’importazione CSV.',
    'app-bound-all':
      'Sono state trovate {count} password salvate, ma la cifratura app-bound più recente del browser non può essere aperta dall’esterno. Esportale in CSV dalla pagina delle password del browser e usa qui l’importazione CSV.',
    'app-bound-some':
      '{skipped} voci su {count} usano la cifratura app-bound più recente e non possono essere importate. Prova l’esportazione CSV per il resto.',
    undecryptable:
      'Sono state trovate {count} password salvate ma non è stato possibile decifrarle. Potrebbe essere un altro utente Windows o un database danneggiato; prova l’esportazione CSV.',
    'copy-failed':
      'Non è stato possibile copiare il database delle password. Potrebbe essere bloccato mentre il browser è aperto: chiudi il browser e riprova. ({detail})',
    'key-unavailable': 'Non è stato possibile leggere la chiave di cifratura del browser. ({detail})',
  },
  ja: {
    'database-missing': 'このブラウザーのパスワードデータベースが見つかりませんでした。',
    'login-data-missing': 'ブラウザーのパスワードファイル (Login Data) が見つかりませんでした。',
    unreadable:
      'ブラウザーには保存済みパスワードが表示されていますが、ファイルから読み取れませんでした。ブラウザーのパスワードマネージャーから CSV としてエクスポートし、ここで CSV インポートを使ってください。',
    'app-bound-all':
      '保存済みパスワードが {count} 件見つかりましたが、ブラウザーの新しいアプリバインド暗号化は外部から開けません。ブラウザーのパスワードページから CSV としてエクスポートし、ここで CSV インポートを使ってください。',
    'app-bound-some':
      '{count} 件中 {skipped} 件が新しいアプリバインド暗号化を使っているため、インポートできません。残りは CSV エクスポートをお試しください。',
    undecryptable:
      '保存済みパスワードが {count} 件見つかりましたが、復号できませんでした。別の Windows ユーザーまたは破損したデータベースの可能性があります。CSV エクスポートをお試しください。',
    'copy-failed':
      'パスワードデータベースをコピーできませんでした。ブラウザーが開いている間はロックされている可能性があります。ブラウザーを閉じてもう一度お試しください。({detail})',
    'key-unavailable': 'ブラウザーの暗号化キーを読み取れませんでした。({detail})',
  },
}

export const PASSWORD_IMPORT_LANGUAGES = Object.keys(COPY)

/** The failure in words in the person's language, or null when it carries no code (the caller words it instead). */
export function describePasswordImportError(locale: string, error: unknown): string | null {
  const failure = parsePasswordImportError(error)
  if (!failure) return null
  const text = (COPY[locale] ?? COPY.en)[failure.code]
  const [first = '', second = ''] = failure.details
  const values: Record<string, string> = {
    count: failure.code === 'app-bound-some' || failure.code === 'app-bound-all' || failure.code === 'undecryptable' ? first : '',
    skipped: failure.code === 'app-bound-some' ? second : '',
    // A message of the system keeps its own colons, so everything after the code is the detail.
    detail: failure.details.join(':'),
  }
  return text.replace(/\{(count|skipped|detail)\}/g, (_match, name: string) => values[name] ?? '')
}
