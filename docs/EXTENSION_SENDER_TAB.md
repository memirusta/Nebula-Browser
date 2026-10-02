# Eklenti paneli `sender.tab` farkı ve compat dosyası

Tarih: 2026-10-01. Ölçüm: WebView2 154.0.4258.37, Windows 11.

## Sorun

Claude eklentisinin yan paneli `claude.ai/cic/new` sayfasını iframe olarak açar. O sayfa eklentiye `chrome.runtime.sendMessage(extId, {type:'get_sidepanel_host_info'})` ile ulaşır (`externally_connectable`). Eklentinin worker'ı cevaba `accountUuid`'yi **yalnızca `sender.tab` tanımsızsa** ekler; claude.ai bu alan yoksa "Can't reach the Claude extension" gösterir.

Chrome'da yan panelin `sender.tab`'ı yoktur. WebView2'de panel penceresi bir "tab" olarak bildirilir, bu yüzden alan hiç gelmez. Çağrı gerçekte başarılıdır; yanlış olan tek şey bu alan.

## Ölçümler (fixture, gerçek WebView2)

`native_extension_sender_platform` (platform, Nebula'dan bağımsız):

| Gönderen | `sender.tab` |
|---|---|
| Gerçek http sayfasının content script'i | var (doğru) |
| Eklenti panelinin üst çerçevesi | var (Chrome'da yok) |
| Panelin içindeki eklenti iframe'i | var, panelin tab'ı (`…/panel.html`) |
| Panelin uzun ömürlü portu (`runtime.connect`) | var |
| Panelin içindeki web sayfası, `externally_connectable` (Claude'un durumu) | var |

Panel ve gerçek sayfa aynı biçimde bir `popup` penceresinde, `index: 0, active: true` bir tab'dır; ikisini ayıran tek şey `tab.url`'nin şemasıdır. Panelin iframe'i panelin tab'ını alır.

## Platform seviyesinde düzeltilebilir mi?

- WebView2'nin eklenti API yüzeyi yalnızca `ICoreWebView2BrowserExtension` (Id, Name, Enable, Remove) ve `Profile7` (Add/Get). Mesajlaşmaya ya da tab modeline dokunan bir API yok. Microsoft sorunu biliyor ve açık tutuyor: [WebView2Feedback #3855](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3855). Workaround ya da bir WebView'ı eklenti API'lerinden dışlama yolu yok.
- Worker'a dışarıdan (DevTools) girmek **güvenilir değil**: ana pencere oturumundan eklenti worker'ı görünmüyor; eklenti sayfasının oturumundan `setAutoAttach` durdurmadan sonra yeniden kurulursa yeni worker `waitingForDebugger: true` ile geliyor, ama ilk betikten önce durdurup shim yerleştirme adımı izole testte 5 varyantta (klasik/module worker, 300 ms/8 sn bekleyiş, üretimle aynı hazırlık) hiç durmadı. Nedeni bulunamadı. Tutulan worker serbest bırakılamazsa eklenti ölü kalıyor. Eklenti mesajla uyanırken (Claude'un durumu) bunu yakalamak ayrıca eklenti başına kalıcı bir oturum ve garantili serbest bırakma gerektirir. Üretim mekanizması olarak reddedildi.

## Çözüm: `extension_compat`

`src-tauri/src/extension_compat.rs` + `extension_compat_shim.js`. Kurulum sırasında (`discovery_entries`, yani izole yükleme kontrolü, önbellek klasörü ve kayıt aynı baytları görür):

- İki dosya eklenir: `nebula-compat.js` (shim) ve `nebula-compat-entry.js`. Manifest'te yalnızca `background.service_worker` bu girişe yönlenir. Giriş önce shim'i, sonra orijinal worker'ı yükler (module için `import`, klasik için `importScripts`). Eklentinin hiçbir dosyası değişmez; `key` (kimlik) aynı kalır.
- Çıktı doğrulanmış paketin saf bir fonksiyonudur (aynı paket, aynı baytlar).
- Shim, `runtime.onMessage`, `onMessageExternal`, `onConnect`, `onConnectExternal` için, **yalnızca** `sender.tab.url` eklentinin kendi `chrome-extension://<id>/` sayfası olan gönderenlerde `tab`'ı kaldırır. Content script'ler ve gerçek sekme çerçeveleri `tab`'ını korur.
- Kullanıcıya özel/Claude'a özel hiçbir şey yok.

Doğrulama: `native_extension_sender_compat` (gerçek WebView2): content script'te `tab` kalır; panelin üst çerçevesi, eklenti iframe'i, port ve panelin içindeki web sayfası (Claude'un yolu) `tab` almaz ve worker normal cevap verir. `native_extension_sender_platform` aynı fixture'ın compat'sız hâlinin tab aldığını sabitler; WebView2 düzelirse o test kırılır ve compat kaldırılır.

## Sınırlar

- `tab.url`, eklentinin `tabs` izni yoksa gizlidir; o durumda gönderen tanınamaz ve **olduğu gibi** bırakılır (gerileme yok, düzeltme de yok).
- `chrome.tabs.query` panel pencerelerini hâlâ tab olarak listeler (`active: true`). Bu farkı kapsamıyoruz.
- Zaten kurulu bir eklentinin klasörü değişmez ("Never rewrite files of a registered WebView2 extension"): compat için eklentiyi kaldırıp yeniden kurmak gerekir.
- Gerçek Claude eklentisiyle canlı doğrulama yapıldı (2026-10-01): panel sohbet ekranını açtı, "Can't reach" çıkmadı. Mesaj gönderme ve araç kullanımı henüz denenmedi.
