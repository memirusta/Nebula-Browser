# Nebula Shield

Nebula'nın kendi reklam, izleyici ve zararlı site engelleyicisi. Eskiden paketlenmiş uBlock Origin Lite uzantısı bu işi yapıyordu; artık
uygulamanın içinde, WebView2'nin kendi olaylarıyla çalışıyor. Bu belge nasıl çalıştığını, neyi indirdiğini ve nasıl güncellendiğini anlatır.

## Parçalar

| Parça | Dosya | Ne yapar |
|---|---|---|
| Motor | `src-tauri/src/shield.rs` | `adblock` (Brave'in adblock-rust'ı, MPL-2.0) ile her isteğe karar verir: geçir, engelle (sessiz yanıt), yönlendir (sahte kaynak). Sayfa script'ini ve sekme başı sayacı da burası üretir. |
| Karar noktası | `src-tauri/src/webview_privacy.rs` | `WebResourceRequested` (her istek), `NavigationStarting` (her gezinti). Ayarlar `webview_apply_privacy` ile gelir. |
| Listeler | `src-tauri/resources/shield/lists/` | EasyList, EasyPrivacy, uBlock filters/privacy/unbreak/badware, Peter Lowe. Uygulamaya `include_str!` ile gömülü. `MANIFEST.json` kaynağı, hash'i ve kural sayısını söyler. Bir de elle yazılan `nebula-tr.txt` var (aşağıya bak). |
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
- **Prosedürel kozmetik filtreler.** `:has-text`, `:upward`, `:xpath`, `:matches-css`, `:matches-attr`, `:matches-path`, `:min-text-length` ve
  `:remove()`, `:remove-attr()`, `:remove-class()`, `:style()` eylemleri sayfada `resources/shield/procedural.js` ile çalışır. Motor bu
  kuralları yalnızca `css-validation` özelliği açıkken ayırır (`Cargo.toml`); kapalıyken `:has-text` gibi seçiciler düz CSS sanılıp tarayıcıca
  atılıyordu. Kurallar veri olarak verilir (en çok 400), sayfa değiştikçe yeniden bakılır (değişim çoksa seyrek), `html`/`body`/gövdeyi
  tutan öğeye dokunulmaz, bir kural kendi işlediği öğeyi hatırlar. Gerçek tarayıcıda her işleç ve eylem elle kurulmuş bir sayfada denendi,
  uygulamada özel kural kutusuyla `example.com`'da denendi. HTML filtreleme (`##^`) ve `$removeparam`/`$csp` gibi seçenekler yok.
- **Worker'lar.** Parmak izi script'i worker'lara ulaşmaz; yazı tipleri, ekran ve saat dilimi kapsam dışı.
- **Reklam gösterildi ölçülemiyor.** YouTube reklam medyasını reklam engelleyici olmadan da 403 ile reddettiği için ölçüm araçları yalnızca vekil
  sayılar (oyuncu yanıtındaki yerleşimler, reklam istekleri, engellenenler) verir.

## Kendi listemiz: `nebula-tr`

Listelerin geri kalanı İngilizce siteler için yazılmış: Türk bir sitede reklam engellenince sitenin reklama ayırdığı kutu boş bir bant olarak
kalıyor (örnek: Hürriyet'te üstte 300 piksellik boşluk). `src-tauri/resources/shield/lists/nebula-tr.txt` bu kutuları gizleyen, elle yazılmış
kuralları tutar. İndirilmez, `build-shield-lists.mjs` ona dokunmaz, "Reklamlar" anahtarına bağlıdır (kapatılırsa bu da kapanır). Kural, reklamın
içinde olduğu gerçek sayfada görülüp eklenir ve seçici sayfanın izin verdiği kadar dardır. Şimdilik Hürriyet, Milliyet, Fanatik, CNN Türk, Sabah, Takvim, Habertürk, Sözcü, NTV, Mynet, Webtekno, Haber7, Sporx, DonanımHaber, ShiftDelete, Yeni Şafak, Maçkolik ve Transfermarkt var. Alışveriş siteleri (Trendyol, Hepsiburada, N11) yok: orada
boş bırakılan üçüncü taraf reklam kutusu görülmedi, gördüklerimiz sitenin kendi kampanya ve ürün alanları ve onları gizlemek içeriği silmek olur.

## Arayüz

- **Semi-Lunar'daki kalkan düğmesi.** Menünün solunda; eskiden orada duran site kilidinin yerini aldı (tek düğme, tek panel). Üzerinde bu
  sayfada engellenenlerin sayısı var (99'dan sonra "99+"). Shield bu site için ya da ayarlardan kapalıysa üstü çarpılı kalkan görünür, sayı
  çıkmaz. Bağlantı güvenli değilse (HTTP) kilidin uyarısı sürer: kalkanın köşesinde turuncu "!" ve turuncu renk. Sayı 1,5 sn'de bir sorulur ve
  yalnızca değişince arayüze iletilir (`BrowserShell` → `nebula-site-info-state` olayı, `shieldSummary`).
- **Panel (`ShieldPanel`), iki sekme.** *Shield* sekmesi: büyük sayaç, reklam/izleyici dağılımı, sayfada en çok engellenen 5 site (adres, kayıt
  edilebilir alan adına indirilir), "bu sitede korumalar" anahtarı (site istisnasıdır: reklam, izleyici ve zararlı site denetiminin hepsini bu
  site için kapatır), parmak izi ve zararlı site denetimi durumu, Ayarlar'daki Shield bölümüne bağlantı (`open-shield-settings`). *Site*
  sekmesi: eski site paneli (`SiteInfoPanel` `embedded` kipinde): bağlantı güvenliği, sayfa koyulaştırma, izinler, bildirimler, site verisini
  temizle. Açılışta Shield sekmesi gelir; sekmeler ok tuşlarıyla gezilir.
- **Kategori ayrımı.** Engelleyen kuralın hangi listeden geldiği motorda bilinmez; izleyici listelerinin (EasyPrivacy, uBlock privacy) kurallarının
  8 baytlık özetleri tutulur ve engelleyen kuralın özeti onlardaysa "izleyici", değilse "reklam" sayılır (`shield::BlockKind`). Kişinin kendi
  kuralları reklam sayılır.
- **Ayarlar > Gizlilik > Nebula Shield.** Gizlilik sayfasının ilk ve en büyük alanı: kendi başlığı ve çerçevesi olan bir bölüm, içinde kartlar.
  Koruma ile ilgili her şey burada: genel bakış (toplam sayaçlar, ana anahtar), neleri engellesin (reklam, izleyici, parmak izi), zararlı
  siteler, tarayıcı korumaları (izleme önleme düzeyi, izleyici engelleme, katı çerez, yalnız HTTPS, GPC/DNT, çerez bandı kalkanı), site
  istisnaları (istisna listesi ve açık site için düğme), kendi kuralların (Shield kuralları ve eski adres listesi) ve listeler (kaynak, kural
  sayısı, "Nebula yazdı" etiketi). Gizlilik'te Shield'ın dışında yalnızca izinler (kamera vb.), gizli mod, veriler ve sıfırlama kaldı.
  Tarayıcı korumaları, istisnalar ve eski adres listesi satırları `SettingsPanel.tsx`'te tanımlı kalır (durumu orada) ve `ShieldSettings`e
  bölüm olarak verilir.
- **Toplam sayaçlar.** Engellenen reklam, izleyici ve durdurulan zararlı sayfa sayıları bu cihazda `shield/stats.json` dosyasında tutulur
  (`%LOCALAPPDATA%\com.nebula.browser\shield\stats.json`); hiçbir yere gönderilmez. Dosya en fazla 20 sn'de bir ve yalnızca değiştiyse yazılır,
  önce yanına yazılıp sonra yerine konur. Ayarlardaki "Sayacı sıfırla" düğmesi sayıyı sıfırlar. Uygulama kapanırken son 20 sn'ye kadar
  bir kısmı yazılmamış olabilir.

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
