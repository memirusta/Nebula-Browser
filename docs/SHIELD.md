# Nebula Shield

Nebula'nın kendi reklam, izleyici ve zararlı site engelleyicisi. Eskiden paketlenmiş uBlock Origin Lite uzantısı bu işi yapıyordu; artık
uygulamanın içinde, WebView2'nin kendi olaylarıyla çalışıyor. Bu belge nasıl çalıştığını, neyi indirdiğini ve nasıl güncellendiğini anlatır.

## Parçalar

| Parça | Dosya | Ne yapar |
|---|---|---|
| Motor | `src-tauri/src/shield.rs` | `adblock` (Brave'in adblock-rust'ı, MPL-2.0) ile her isteğe karar verir: geçir, engelle (sessiz yanıt), yönlendir (sahte kaynak). Sayfa script'ini ve sekme başı sayacı da burası üretir. |
| Karar noktası | `src-tauri/src/webview_privacy.rs` | `WebResourceRequested` (her istek), `NavigationStarting` (her gezinti). Ayarlar `webview_apply_privacy` ile gelir. |
| Listeler | `src-tauri/resources/shield/lists/` | EasyList, EasyPrivacy, uBlock filters/privacy/unbreak/badware, Peter Lowe. Uygulamaya `include_str!` ile gömülü. `MANIFEST.json` kaynağı, hash'i ve kural sayısını söyler. |
| Scriptlet'ler | `src-tauri/resources/shield/ubo-scriptlets.json` | uBlock Origin'in scriptlet'leri ve yönlendirme kaynakları (153 + 47). Listeler `+js(...)` ile çağırır. |
| Zararlı site sayfası | `src-tauri/src/shield_block_page.rs` | Malware listesinde olan bir sitenin açılışını durdurur ve yerine 9 dilli bir sayfa koyar. |
| URLhaus | `src-tauri/src/shield_updates.rs` | İsteğe bağlı: canlı zararlı adres listesini indirir (aşağıya bak). |
| Parmak izi | `src-tauri/src/fingerprint.rs`, `resources/shield/fingerprint.js` | Canvas, WebGL, ses ve çekirdek sayısı okumalarını siteye göre hafifçe değiştirir. |
| Eski kurulumları temizleme | `src-tauri/src/legacy_blocker.rs` | Eski sürümlerin profile kurduğu uBlock Origin Lite'ı kimliğiyle bulup kaldırır. |

## Bir istek nasıl karara bağlanır

1. Belge istekleri hariç her istek `WebResourceRequested` olayına düşer. Motor `(adres, sayfa adresi, tür)` ile sorulur.
2. `Allow`: dokunulmaz. `Block`: tür başına sessiz bir yanıt verilir (script için boş 200, xhr/fetch için 403, diğerleri 204) ve `X-Nebula-Shield: blocked`
   başlığı eklenir. `Redirect`: kuralın adını verdiği sahte kaynak (`noop.js`, `1x1.gif`…) gerçek içerikle döner.
3. Site istisnası (Ayarlar > Gizlilik > Site istisnaları ya da site panelinden) olan sitede hiçbiri çalışmaz.
4. Her ana çerçeve gezintisinde (`NavigationStarting`) sayfaya özel bir script `AddScriptToExecuteOnDocumentCreated` ile eklenir: o adres için
   listelerin istediği scriptlet'ler ve gizleme kuralları (her seçici ayrı bir CSS kuralı). Bu script yalnızca ana çerçevede çalışır.
5. Sayfa açılışı: yalnızca malware listeleri (`ubo-badware` ve indirilmişse URLhaus) sorulur. Eşleşirse gezinti iptal edilir ve uyarı sayfası gelir.

## Bilmen gereken sınırlar

- **Sayfalar uygulamaya mesaj atamaz.** `window.chrome.webview` her sayfadan gizlenir (`tab_fullscreen.rs`), hata sayfaları dahil. Sayfadaki düğmeler bu
  yüzden `https://nebula-*.invalid/...?code=...` adreslerine gider; `NavigationStarting` bunları tanıyıp iptal eder (uyarı sayfasının "devam et" ve "geri
  dön" düğmeleri, hata sayfasının "korumalar kapalı dene" düğmesi). Kod tek kullanımlıktır ve yalnızca Nebula'nın ürettiği sayfada vardır.
- **Kayıt asenkron.** Sayfa script'i ve parmak izi script'i `AddScriptToExecuteOnDocumentCreated` ile kaydedilir ve tarayıcı bunu kabul edene kadar zaman
  geçer; kayıt bitmeden belge oluşursa o belge korumasız kalır. Kabuğun başlattığı her gezinti (adres çubuğu, yeni sekme, bağlantı açma) bu yüzden
  önce `webview_navigate` içinde `prepare_navigation` ile scriptleri kaydettirir ve en çok ~0,8 sn bekler; gezinti scriptler yerindeyken başlar. Sayfanın
  kendi başlattığı gezintilerde (bağlantıya tıklama, yönlendirme) bu garanti yoktur: sayfa script'i host başına tutulduğundan aynı hosta dönüşlerde
  yerindedir, yeni bir host için ağ gecikmesi genellikle yeter. Her kayıt numaralıdır (`ScriptSlot`): geç gelen eski kaydın id'si gelir gelmez
  kaldırılır, böylece bir sitenin script'i (özellikle parmak izi tohumu) başka sitede kalmaz.
- **Prosedürel kozmetik filtreler yok.** `:has-text`, `:upward`, XPath gibi sayfaya bakmayı gerektiren seçiciler çalışmaz (tarayıcı geçersiz
  seçiciyi tek başına düşürür). Yalnızca düz seçici + `:style()` olanlar uygulanır. HTML filtreleme (`##^`) ve `$removeparam`/`$csp` gibi seçenekler yok.
- **Worker'lar.** Parmak izi script'i worker'lara ulaşmaz; yazı tipleri, ekran ve saat dilimi kapsam dışı.
- **Reklam gösterildi ölçülemiyor.** YouTube reklam medyasını reklam engelleyici olmadan da 403 ile reddettiği için ölçüm araçları yalnızca vekil
  sayılar (oyuncu yanıtındaki yerleşimler, reklam istekleri, engellenenler) verir.

## Ağa ne gider

Shield çalışırken kendiliğinden hiçbir şey indirmez. Listeler ve scriptlet'ler uygulamayla gelir. **Tek istisna** Ayarlar > Gizlilik > Nebula Shield >
"Zararlı site listesini güncel tut" anahtarıdır (varsayılan KAPALI): açılınca `https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-vivaldi-online.txt`
adresinden en fazla 12 saatte bir tek `GET` yapılır (çerezsiz, genel User-Agent, yalnızca HTTPS, boyut ve içerik doğrulaması, atomik yazma). Kapatınca
indirilen dosya silinir. Bu davranış testlerle korunur (`tests/shield-settings.test.ts`).

## Listeleri güncelleme

Listeler yalnızca yeni bir Nebula sürümüyle yenilenir:

```powershell
node scripts/build-shield-lists.mjs                       # listeleri indirir, ön işleme yönergelerini çözer, MANIFEST.json yazar
node scripts/build-shield-resources.mjs <uBlock kaynağı>  # scriptlet'leri ve yönlendirme kaynaklarını üretir
npm.cmd run test:regression
```

- `build-shield-lists.mjs` uBlock'un **birleştirilmiş** `.min.txt` dosyalarını kullanır: ham `filters.txt` yalnızca çekirdektir (kuralların yaklaşık
  dörtte biri) ve `!#include` ile yıllık parçaları ister. Motor `!#if ... !#endif` gibi yönergeleri yorum sayar, bu yüzden Nebula'nın ortamı için
  (Chromium/Edge, masaüstü, HTML filtreleme yok) betik tarafından çözülür.
- `build-shield-resources.mjs` için uBlock Origin'in kaynağının (`gorhill/uBlock`, `src/js/resources`, `src/js/redirect-resources.js`,
  `src/web_accessible_resources`) bir kopyası gerekir. Listelerin istediği her scriptlet'in var olduğunu `tests/shield-resources.test.ts` denetler.
- Sonra: Rust testleri (`cargo test --lib --features extension-native-smoke shield`) ve bir ölçüm (`scripts/shield-measure-run.mjs`).

## Ölçüm

`scripts/shield-measure-run.mjs` ayrı kimlikli bir derlemeyi (`src-tauri/tauri.perf.conf.json`) CDP ile sürer ve bir sayfanın ne istediğini, neyin
engellendiğini ve YouTube'da vekil sayıları kaydeder. `--baseline` shield ve diğer korumalar kapalı, `--shield` yalnızca shield açık demektir. Çalışan
uygulamanın yeniden derlenmesiyle çakışmamak için ölçülen exe'nin bir kopyası kullanılmalıdır; aynı kimliğin iki örneği aynı anda çalıştırılmamalıdır
(aynı profil, tek örnek devri).
