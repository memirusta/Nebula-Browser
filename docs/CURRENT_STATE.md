# Nebula current state

Son doğrulama: **2026-09-01**

Workspace: `D:\Projects\nebula`

Bu belge yaşayan durum özetidir. Eski sohbetleri veya tahminleri değil, son doğrulanmış repo ve test durumunu temsil eder.

## Kısa karar

**v1.8.4 release adayı için application ve test kapıları yeşil; çalışma ağacı commit/PR ve artifact aşamaları tamamlanmadan yayınlanmamalı (NO-SHIP).**

Başlıca nedenler:

- Çalışma ağacı henüz review/commit edilmemiş 53 tracked değişiklik ve 10 untracked dosya içeriyor.
- Release branch `release/v1.8.4`, taban HEAD `4508380`, mevcut tag `v1.8.3`; kaynak sürüm metadata'sı `1.8.4` olarak hazırlandı.
- `release/latest.json` mevcut v1.8.3 installer'ına işaret ediyor; yeni release artifact'i için henüz yeniden üretilmedi.
- Commit/PR, yeni release artifact'i, updater manifest'i ve Store paketi henüz oluşturulmadı.

## Git ve sürüm snapshot'ı

| Alan | Doğrulanan değer |
| --- | --- |
| Branch | `release/v1.8.4` |
| HEAD | `4508380` |
| HEAD üzerindeki tag | `v1.8.3` |
| Tracked değişiklik | 53 |
| Untracked dosya | 10 |
| `package.json` | `1.8.4` |
| `package-lock.json` | `1.8.4` |
| `src-tauri/tauri.conf.json` | `1.8.4` |
| `src-tauri/Cargo.toml` | `1.8.4` |
| Updater manifest | Mevcut v1.8.3 release'ına işaret ediyor |

Sonraki release aynı `v1.8.3` adıyla yayımlanmamalı. Emir'in kararıyla release adayı `v1.8.4` olarak hazırlandı.

## Untracked ve özellikle korunması gereken dosyalar

Bu dosyalar henüz Git tarafından izlenmiyor; sonraki commit hazırlanırken unutulmamalı ve içerikleri ayrıca review edilmelidir:

- `src/components/DeveloperTools/DeveloperTools.copy.additional.ts`
- `src/components/DeveloperTools/DeveloperTools.copy.it-ja.ts`
- `src/core/localeMessages.additional.ts`
- `src/core/localeMessages.de.ts`
- `src/core/localeMessages.es.ts`
- `src/core/localeMessages.it-ja.ts`
- `src/platform/tauriCreationWait.ts`
- `tests/browsing-dock-regression.test.ts`

## Mevcut iş kapsamı

Post-v1.8.3 çalışma ağacı; geniş UI localization, İspanyolca/Almanca/Fransızca/Endonezce/Rusça/İtalyanca/Japonca metinleri, Nebula Inspector iyileştirmeleri, Instagram notification davranışı, browsing dock/window creation bekleme mantığı ve çeşitli native/frontend regression düzeltmelerini içeriyor.

Bu özet dosya bazında tamamlanmış code review yerine geçmez. Release öncesinde toplam 63 çalışma girdisi tek tek amaçlanan kapsam olarak sınıflandırılmalıdır.

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

2026-09-01 pre-release audit sırasında:

- `git diff --check`: geçti; yalnızca line-ending dönüşüm uyarıları görüldü.
- Frontend lint: geçti.
- Production frontend build: geçti.
- Frontend regression: **181/181 geçti**.
- `cargo fmt --all -- --check`: geçti.
- `cargo clippy --all-targets -- -D warnings`: geçti.
- `cargo test --all-targets`: **88 geçti, 0 başarısız, 1 interactive DPAPI testi beklenen biçimde ignored**.
- Temiz ve ayrı bir target dizininde x64 release binary build: geçti.

Audit binary kanıtı, yeni release artifact'i değildir:

| Alan | Değer |
| --- | --- |
| Boyut | 12,281,856 byte |
| File/product version | `1.8.3` |
| SHA-256 | `97F2009DAAD31060665FE46D86A8A1F4DDDBACA34CBBDF9807EB5576A38D4829` |

Normal target'a ilk build yalnızca çalışan Nebula process'i `src-tauri\target\x86_64-pc-windows-msvc\release\app.exe` dosyasını kilitlediği için başarısız oldu. Ayrı target build'i geçti; audit target dizini kanıt alındıktan sonra silindi.

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
- Son post-v1.8.3 değişiklikleriyle güncel Store source parity henüz yeniden audit edilmedi.
- Store sync sırasında updater-free ayrımı, package identity, `Package.appxmanifest`, signing ve packaging dosyaları korunmalıdır.
- WACK PASS veya certification sonucu tek başına Store'da yayınlandığını göstermez; Partner Center publication durumu ayrıca doğrulanır.

## Sıradaki güvenli adımlar

1. 63 çalışma ağacı girdisini intended / generated / unrelated olarak review et.
2. Yalnızca amaçlanan dosyaları explicit olarak stage et; commit/PR üzerinden review et.
3. Merge edilen kesin commit snapshot'ından Store ağacını yedekli ve updater-free ayrımını koruyarak senkronize et.
4. `docs/RELEASE_CHECKLIST.md` içindeki quality gate'leri merge commit ve Store ağacı üzerinde yeniden çalıştır.
5. Tag sonrası installer'ı build/sign et; hash, signature ve version bilgisini doğrula.
6. `release/latest.json` dosyasını yalnızca gerçek imzalı artifact ve kesin URL ile üret.
7. MSIX, WACK ve Partner Center kanıtlarını bağımsız doğrula.

## Güncelleme kuralı

Bu dosyayı yalnızca doğrulanmış state değiştiğinde güncelle. Geçmiş sonuçları sessizce yeniden kullanma; tarih, commit, test sayısı, hash ve publication bilgilerini her release adayında yeniden ölç.
