# Nebula current state

Son doğrulama: **2026-09-07**

Workspace: `D:\Projects\nebula`

Bu belge yaşayan durum özetidir. Eski sohbetleri veya tahminleri değil, son doğrulanmış repo ve test durumunu temsil eder.

## Kısa karar

**v1.8.4 `main` üzerine merge edilmiş ve tag/updater metadata zinciri tamamlanmıştır. Çalışma ağacında LAN navigation/error-page ve Store ilk site açılışı düzeltmeleri vardır; bunlar henüz commit veya yeni release değildir (NO-SHIP as-is).**

## Store ilk site açılışı — 2026-09-07

- Temiz Windows 11 Pro 25H2 Hyper-V makinesinde Store 1.8.4.0 ile hata tekrarlandı: Home ve Ayarlar çalışıyor, site açılmıyor. WebView2 152.0.4191.66 ve paketteki bütün kural dosyaları mevcut.
- Aynı Store package identity korunarak alınan WebView2 günlüğü, `WindowsApps/.../resources/extensions/ubol` yüklemesinde `ublock-filters.json: Internal error while parsing rules.` hatasını gösterdi. Chromium bu mesajı işlenmiş DNR kurallarını diske kaydedemediğinde üretiyor; paket dizini salt okunur.
- Normal ve Store kaynaklarında uBlock artık yükleme öncesi `app_local_data_dir()/extensions/ubol/<version>-<bundle-sha256>/<slot>/ubol` altına hazırlanıyor. Paket dosyaları değiştirilmez. Paket içeriğinin tümü SHA-256 adreslemeye dahil edilir; tamamlanan kopya byte düzeyinde doğrulanıp atomik rename ile yayımlanır.
- Kaynaktaki `_metadata` taşınmaz; Chromium'un hedefte ürettiği `_metadata` sonraki açılışlarda korunur. Bozuk/yarım kopya yerinde değiştirilmez; yeni bir slot hazırlanır. Aynı anda başlayan hazırlıklar aynı tamamlanmış dizine yakınsar.
- Mevcut etkin profil eklentisini kullanan açılış davranışı korunur; bu düzeltme zorunlu profil migrasyonu veya eski eklenti ayarlarını taşıma işlemi yapmaz.
- Site oluşturma hataları Home'da uygulama diyaloğuyla gösterilir; Türkçe dahil dokuz dilde açıklama ve altta hata detayı sunulur. Production'da yalnız hata geçişleri varsayılan olarak kaydedilir; rutin geçiş kayıtları opt-in kalır.
- Doğrulama: her iki ağaçta format/Clippy, lint ve frontend build geçti. Normal frontend **188/188**, Store frontend **185/185**; normal Rust **100 geçti / 1 ignored**, Store Rust **94 geçti / 1 ignored**. Altı yeni cache testi salt okunur kaynak, eşzamanlı hazırlık, bozuk/eksik kopya, paket değişimi ve üretilmiş kural korumasını kapsıyor. Normal UI/E2E smoke **PASS**.
- Normal ve Store x64 binary buildleri geçti. Düzeltilmiş Store binary'si yalnız VM testi için geçici `1.8.4.1` manifest sürümü ve yerel test sertifikasıyla MSIX olarak paketlendi; bunun kaynak sürümüne veya yayın metadata'sına etkisi yok. Temiz VM'de ilk `https://example.com` navigasyonu kullanıcı tarafından başarılı olarak doğrulandı. VM raporu yazılabilir cache'in varlığını, bir cached manifest'i, 56 Chromium-generated indexed rule dosyasını ve sıfır extension load error'ı doğruladı. Yayımdaki Store 1.8.4.0 paketi değiştirilmedi. Commit, sürüm artırımı veya yayın yapılmadı.
- Store öncesi dosya yedeği: `D:\Projects\nebula-store-backups\20260907-ublock-writable-cache`. Ortak düzeltmeler dar patchlerle uygulandı; updater, Store identity ve packaging ayrımları korunuyor.

## Onboarding rehberi ve tarafsız kullanıcı adı — 2026-09-07

- Profil adımı boş geçilen yeni kurulumlarda sabit `memir` adı yerine `User` kullanılıyor. Kullanıcının daha önce kaydettiği görünen ad değiştirilmez.
- Onboarding'in sonundaki Başla eylemi artık gerçek ekran rehberini açıyor. Ekran hafifçe kararıyor; üst kenar, Semi-Lunar içeriği, Home arama/adres alanı ve sağ araç çubuğu dört ayrı spotlight ve açıklama balonuyla gösteriliyor. Tümünü atla, geri, ileri ve bitir eylemleri her adımda erişilebilir.
- İlk iki adım ayrı Tauri Chrome WebView'ıyla event bridge üzerinden eşleşiyor. Birinci adımda Home'un `homeAlwaysOpen` tercihi yalnız tur sürerken geçici olarak kapatılıyor; kullanıcı üst kenardaki parçacıklı parıltıya hover yaptığında normal açılma gecikmesi ve gerçek ayrılınca kapanma davranışı çalışıyor. İkinci adım Semi-Lunar'ı açık tutuyor; panel çevresini hafifçe, geçici YouTube örnek sekmesini daha güçlü vurguluyor ve gerçek hover davranışını metinle açıklıyor. Örnek sekmeye hover veya klavye odağı geldiğinde normal kullanıcı ayarındaki gecikmeyle yerelleştirilmiş site bilgi önizlemesi açılıyor; örnek sekme kullanıcı verisine kaydedilmiyor. İlk balon, açılan Semi-Lunar'ın altında sabit kalıyor. Son iki adımda Chrome yüzeyi gizlenerek Home'daki gerçek adres alanı ve araç çubuğu öne çıkarılıyor. Reduced-motion ve klavye/focus-trap davranışları var.
- Yarım bırakılan ilk rehber bir sonraki açılışta devam ediyor; bitirme veya Tümünü atla tekrar açılmasını engelliyor. Tek seferlik onboarding rehberi Ayarlar kategorilerinde veya ayar aramasında gösterilmiyor. Rehber metinleri ve ikinci adımdaki site bilgi önizlemesi dokuz uygulama dilinde tanımlandı.
- Normal ve Store kaynakları eşitlendi; Store'a özel güncelleme alanı korundu. Normal lint/build ve **192/192**, Store updater audit **6/6**, lint/build ve **193/193** regression geçti. Gerçek x64 uygulamada görsel kullanıcı akışı henüz elle doğrulanmadı.

Başlıca nedenler:

- `main`, `origin/main` ve `v1.8.4` aynı `99b9168` merge commit'indedir.
- `release/latest.json`, yayımlanmış `v1.8.4` Windows x64 installer URL ve signature bilgisini içerir.
- Yerel değişiklikler şemasız LAN adreslerini HTTP ile açar; explicit scheme kararını korur; HTTPS-only için gerçek private/link-local adresleri istisna tutar.
- WebView2 error status'ları artık isimli gösterilir; certificate/DNS/timeout/auth/server/network türleri ayrılır. Yerel sertifika hatasında otomatik bypass yerine kullanıcı kontrollü HTTP fallback sunulur.
- `192.168.1.1` gerçek router akışı 2026-09-02 tarihinde kullanıcı ekran görüntüsüyle doğrulandı: şemasız giriş Huawei HG8245X6-10 yönetim arayüzünü başarıyla açtı.

## Git ve sürüm snapshot'ı

| Alan | Doğrulanan değer |
| --- | --- |
| Branch | `main` (`origin/main` ile aynı) |
| HEAD | `99b9168715e512b3da477148293d42186d00e5d2` |
| HEAD üzerindeki tag | `v1.8.4` |
| Çalışma ağacı | LAN/error-page + Store ilk açılış düzeltmeleri; güncel dosya listesi için `git status --short` |
| `package.json` | `1.8.4` |
| `package-lock.json` | `1.8.4` |
| `src-tauri/tauri.conf.json` | `1.8.4` |
| `src-tauri/Cargo.toml` | `1.8.4` |
| Updater manifest | `v1.8.4` / gerçek GitHub x64 installer URL ve signature |

Sonraki release mevcut `v1.8.4` tag'i altında yeniden yayımlanmamalıdır; bu yerel düzeltme yayımlanacaksa yeni sürüm kararı gerekir.

## Untracked ve özellikle korunması gereken dosyalar

Bu dosyalar mevcut LAN/error-page düzeltmesinin parçasıdır ve sonraki commit hazırlanırken açık adlarıyla review edilmelidir:

- `src-tauri/src/network_address.rs`
- `src/core/addressNavigation.ts`
- `tests/address-navigation.test.ts`

## Mevcut iş kapsamı

Mevcut çalışma ağacı LAN adres çözümleme, HTTPS-only yerel adres istisnası, WebView2 error-page sınıflandırması/çevirileri, güvenli yerel HTTP eylemi ve yukarıdaki Store ilk site açılışı düzeltmesini içerir.

Sertifika güveni otomatik verilmez ve public HTTPS hedeflerine HTTP downgrade sunulmaz. Error-page URL'leri script literal içine güvenli biçimde gömülür.

## Startup memory optimizasyonu

- İlk browsing prewarm, uBlock profile hazır olduktan sonra doğrudan oluşturulmak yerine **5 saniye gecikmeli** planlanır; Home'un ilk açılış maliyeti azaltılır.
- Hazır ve gizli prewarm WebView, WebView2 `LOW` memory usage target seviyesine alınır.
- Prewarm gerçek sekme olarak adopt edildiğinde privacy ve navigation başlamadan önce normal memory target seviyesine döndürülür.
- Memory pressure nedeniyle prewarm discard etme ve private-mode profile eşleşme korumaları aynen korunur.

## Page darkening form alanları

- Light sayfalarda birincil koyulaştırma motoru WebView2/Chromium paint katmanındaki `Emulation.setAutoDarkModeOverride` çağrısıdır. Bu motor DOM mutation sırasına bağlı olmadan dinamik SPA durumlarını, form kontrollerini ve Chromium'un görsel sınıflandırmasını birlikte işler.
- Sayfanın kendi `prefers-color-scheme` dark teması önce korunur. Chromium tarafında `color-scheme: dark` bildiren elemanlar yeniden zorla koyulaştırılmaz.
- CDP çağrısı runtime tarafından desteklenmez veya reddedilirse mevcut seçici DOM algoritması otomatik fallback olarak çalışır.
- Algoritmik page darkening, normal DOM metnine ek olarak `input`, `textarea`, `select`, `button` ve `contenteditable` kontrollerini açıkça metin taşıyan eleman olarak değerlendirir.
- Koyu foreground algılanan form alanlarında, yalnızca gerçek render edilmiş yüzey de koyuysa yazı, caret ve WebKit autofill text rengi birlikte açılır; beyaz kalan Gmail benzeri yüzeylerde metin koyu bırakılarak açık yazı/açık zemin hatası önlenir. Placeholder koyulaştırılmış yüzeylerde ayrı ve daha düşük vurgulu açık gri kalır.
- Focus, input ve change durumları class/style mutation gerektirmeden yeniden değerlendirilir; dinamik eklenen kontroller mevcut MutationObserver akışıyla işlenir.
- Bu iyileştirme açık DOM form kontrollerini kapsar. Shadow DOM ve iframe içeriği için evrensel uyumluluk iddiası yoktur; per-site `Off` override güvenli kaçış yolu olarak korunur.

Kod doğrulaması geçti; gerçek resident-memory kazancı release binary yeniden başlatıldıktan sonra aynı makinede başlangıç, 10 saniye idle ve ilk sekme sonrası ölçülmelidir.

## Instagram notification kararı

Mevcut strateji bilinçli olarak konservatiftir:

- Rich sender/message/reaction içeriği yalnızca exact DM route'u (`/direct/t/`) açıkken ve konuşma DOM'u geometrik olarak doğrulanabildiğinde çıkarılır.
- Diğer DM'lerde gerçek WebView2 veya service-worker notification payload'ı tercih edilir.
- Authoritative zengin payload yoksa generic title/unread fallback kullanılır.
- Inbox row body scraping ve forced off-DM scan kaldırıldı; çünkü `Typing...` gibi geçici durumları gerçek mesaj sanabiliyordu.
- Geçici ve generic Instagram metinleri desteklenen locale'lerde filtrelenmeye devam eder.
- Trusted Instagram CDN ailesinden bir sender profile picture bulunursa Windows toast'ta Instagram logosu yerine dairesel PP kullanılır; güvenilir PP bulunamazsa logo fallback olarak kalır.
- Emoji veya yalnızca sembolden oluşan display name'ler artık avatar eşleştirmesinde boş anahtara düşmez. Emoji variation selector farkları (`❤` / `❤️`) aynı profile picture ile eşleşir.

Son odaklı notification regression sonucu: **15/15 geçti**. Emoji-only avatar Rust testleri **2/2 geçti**. Bu davranış değiştirilirse reaction, art arda mesaj, farklı DM açıkken bildirim ve DM inbox görünümü ayrı senaryolar olarak yeniden test edilmelidir.

## Son doğrulama kanıtı

2026-09-02 LAN/error-page düzeltmesi sırasında:

- `git diff --check`: geçti; yalnızca line-ending dönüşüm uyarıları görüldü.
- Frontend lint: geçti.
- Production frontend build: geçti.
- Frontend regression: **185/185 geçti**.
- UI/E2E smoke: **PASS**.
- `cargo fmt --all -- --check`: geçti.
- `cargo clippy --all-targets -- -D warnings`: geçti.
- `cargo test --all-targets`: **94 geçti, 0 başarısız, 1 interactive DPAPI testi beklenen biçimde ignored**.
- x64 release binary build: geçti.
- Native window/stability smoke: **PASS**; pencere açıldı ve süreç 5 saniyelik kontrol boyunca yaşadı.

Yerel doğrulama binary'si yeni imzalı/yayımlanmış release artifact'i değildir:

| Alan | Değer |
| --- | --- |
| Yol | `src-tauri\target\x86_64-pc-windows-msvc\release\app.exe` |
| Boyut | 12,290,560 byte |
| File/product version | `1.8.4` |
| SHA-256 | `4FFDDC0FD603780F220BFFED38DF60386FA6CD82C0503CA61391E8F928F06267` |
| Çalışan doğrulama PID | `8136` |

Kurulu eski Nebula süreci graceful olarak kapatıldı. Native smoke sonrası yukarıdaki doğrulanmış release binary'si kullanıcı arayüzü açık biçimde başlatıldı ve yanıt veriyor.

## E2E test altyapısı

İlk `npm.cmd run test:e2e` denemesinde Chrome 152'nin GPU child process'i kısıtlı Windows test job'ında `STATUS_ACCESS_DENIED` ile kapanıp şu fatal sonucu üretti:

```text
FATAL: GPU process isn't usable. Goodbye.
```

Harness, disposable profile ve localhost kapsamı korunarak GPU/software rasterizer kapalı çalışacak biçimde güncellendi. Nested Windows sandbox çakışması için yalnız test Chrome sürecinde `--no-sandbox` kullanılıyor; fixture dış adresleri `0.0.0.0`'a yönlendiriliyor ve browser stderr başarısızlıkta raporlanıyor. Bu ayarlar Nebula production binary'sine taşınmıyor.

Yeniden çalıştırılan E2E sonucu: **PASS**. App shell, History, Settings, keyboard focus ve iki crash-recovery akışı doğrulandı.

## Store durumu

- Store ağacı: `D:\Projects\nebula-store`.
- Bu ağaç Git repository değildir.
- v1.8.4 sonrası yerel LAN navigation/error-page değişiklikleri 2026-09-07 tarihinde Store ağacına aktarıldı. Yedi ortak source/test dosyası satır sonları normalize edilerek ana repo ile içerik eşitliğinde doğrulandı; `lib.rs` içinde yalnız `network_address` modülü eklenip Store'a özel `store_update` akışı korundu.
- Store updater-free audit **6/6**, lint ve production build geçti. Frontend regression **189/189**, Rust **100 geçti / 1 interactive DPAPI testi ignored**; `cargo fmt --check` ve Clippy warning-as-error geçti.
- Store sync sırasında updater-free ayrımı, package identity, `Package.appxmanifest`, signing ve packaging dosyaları korunmalıdır.
- WACK PASS veya certification sonucu tek başına Store'da yayınlandığını göstermez; Partner Center publication durumu ayrıca doğrulanır.

## Sıradaki güvenli adımlar

1. Explicit `https://192.168.1.1/` sertifika hatasında isimli status, doğru güvenlik metni ve yalnız yerel hedefte `HTTP ile dene` eylemi unit testlerle doğrulandı; gerekirse ayrıca görsel smoke yapılabilir.
2. Sekiz amaçlanan çalışma ağacı girdisini review et; yalnız açık dosya yollarıyla stage/commit et.
3. Yeni release istenecekse `v1.8.4` tag'ini yeniden kullanma; yeni version, installer/updater ve Store zincirini `RELEASE_CHECKLIST.md` ile bağımsız doğrula.

## Güncelleme kuralı

Bu dosyayı yalnızca doğrulanmış state değiştiğinde güncelle. Geçmiş sonuçları sessizce yeniden kullanma; tarih, commit, test sayısı, hash ve publication bilgilerini her release adayında yeniden ölç.
