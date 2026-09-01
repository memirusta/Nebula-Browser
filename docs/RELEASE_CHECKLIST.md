# Nebula release checklist

Bu checklist GitHub/direct-download release ile Microsoft Store paketini ayrı kanıt zincirleri olarak ele alır. Kutuları yalnızca ilgili komut veya uzaktaki durum gerçekten doğrulandığında işaretle.

`<NEXT_VERSION>` ve artifact adlarını gerçek release kararı verildikten sonra doldur. Mevcut `v1.8.3` tag'i yeniden kullanılmamalıdır.

## 1. Release kapsamı ve preflight

- [ ] `docs/CURRENT_STATE.md` okundu ve güncellendi.
- [ ] `git status --short`, branch, HEAD ve mevcut tag'ler kaydedildi.
- [ ] Tüm tracked değişiklikler amaçlanan / ilgisiz / generated olarak sınıflandırıldı.
- [ ] Tüm untracked source ve test dosyaları tek tek review edildi.
- [ ] Kirli çalışma ağacında `git add .` veya `git add -A` kullanılmadı.
- [ ] Release notes kapsamı gerçek diff ile eşleşiyor.
- [ ] Yeni sürüm numarası seçildi: `<NEXT_VERSION>`.
- [ ] `<NEXT_VERSION>` mevcut Git tag, GitHub release veya Store submission ile çakışmıyor.

Önerilen read-only preflight:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git tag --points-at HEAD
git diff --check
npm.cmd run release:preflight
```

## 2. Sürüm metadata'sı

Aynı sürüm aşağıdaki kaynaklarda doğrulanmalıdır:

- [ ] `package.json`
- [ ] `package-lock.json` root package girdileri
- [ ] `src-tauri/tauri.conf.json`
- [ ] `src-tauri/Cargo.toml`
- [ ] `src-tauri/Cargo.lock` içindeki Nebula package girdisi
- [ ] Windows installer/binary file ve product version

`release/latest.json` bu aşamada tahmini URL, eski signature veya eski hash ile güncellenmez. Gerçek imzalı artifact hazır olduktan sonra oluşturulur.

## 3. Frontend quality gate

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run build
npm.cmd run test:regression
npm.cmd run test:e2e
```

- [ ] Dependency kurulumu lockfile ile tamamlandı.
- [ ] Lint geçti.
- [ ] Production build geçti.
- [ ] Regression testlerinin tamamı geçti; gerçek pass/fail sayıları release notuna kaydedildi.
- [ ] E2E geçti. Chrome/headless altyapı sorunu varsa düzeltildi veya risk sahibi tarafından açıkça waive edildi.

## 4. Rust/native quality gate

`src-tauri` dizininden:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
```

Repo kökünden:

```powershell
npm.cmd run test:native-smoke
npm.cmd run tauri:build:binary
```

- [ ] Rust format kontrolü geçti.
- [ ] Clippy warning-as-error ile geçti.
- [ ] Rust testleri geçti; ignored testler isim ve nedenle kaydedildi.
- [ ] Native smoke geçti.
- [ ] x64 release binary temiz build ile üretildi.
- [ ] Çalışan Nebula process'i artifact'i kilitlemedi; process kullanıcı izni olmadan kapatılmadı.

## 5. Kritik kullanıcı akışları

En az aşağıdaki gerçek akışları release adayı üzerinde doğrula:

- [ ] Normal startup ve mevcut session davranışı.
- [ ] Yeni tab, navigation, back/forward, refresh ve kapatma.
- [ ] Multi-window tab transfer: target ownership, source cleanup ve timeout rollback.
- [ ] F11 / HTML5 fullscreen giriş-çıkış ve Alt+Tab sonrası restore.
- [ ] Tek bir branded `Nebula` Windows media card; duplicate veya `Unknown app` yok.
- [ ] Bildirim izni, notification center ve click-to-open davranışı.
- [ ] Instagram mesaj, reaction ve art arda bildirim; `Typing...` message body olarak pushlanmıyor.
- [ ] Dil seçimi, onboarding ve en az bir LTR/non-English locale smoke testi.
- [ ] Nebula Inspector: Elements, Console, Network, Performance, Storage, Site, Sources, Accessibility ve Events temel akışları.
- [ ] Clear site data, cookie/tracker protection ve izin UI'ının gerçek davranışla uyumu.
- [ ] Clean install ve upgrade install akışları.

İlgili scriptler:

```powershell
npm.cmd run test:release-smoke
npm.cmd run test:clean-install
npm.cmd run test:upgrade-install
```

## 6. Commit, PR ve tag

- [ ] Yalnızca review edilmiş dosyalar explicit path'lerle stage edildi.
- [ ] Staged diff son kez okundu.
- [ ] Commit mesajı değişiklik kapsamını doğru anlatıyor.
- [ ] PR checks geçti ve hedef commit kesin olarak belirlendi.
- [ ] Merge sonrası remote branch SHA doğrulandı.
- [ ] `v<NEXT_VERSION>` tag'i tam olarak yayımlanacak commit üzerinde oluşturuldu.
- [ ] Remote tag SHA yerel commit ile eşleşiyor.

Commit, push, PR ve tag adımları kullanıcı açıkça istemeden yürütülmez.

## 7. Direct-download installer ve updater

- [ ] Installer temiz release commit/tag üzerinden üretildi.
- [ ] EXE Authenticode/code-signing sonucu doğrulandı.
- [ ] Binary ve installer file/product version `<NEXT_VERSION>` ile eşleşiyor.
- [ ] Artifact boyutu ve SHA-256 kaydedildi.
- [ ] Installer clean-install ve upgrade-install testlerini geçti.
- [ ] GitHub release asset adı ve URL'si gerçek upload sonrası doğrulandı.
- [ ] Tauri updater signature gerçek artifact için üretildi ve doğrulandı.
- [ ] `release/latest.json` version, `pub_date`, notes, exact URL ve signature ile en son güncellendi.
- [ ] `npm.cmd run test:updater-remote` canlı URL üzerinde geçti.
- [ ] GitHub release/tag/assets başka bir makineden veya temiz sorguyla yeniden doğrulandı.

Örnek hash doğrulaması:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<ARTIFACT_PATH>'
Get-AuthenticodeSignature -LiteralPath '<ARTIFACT_PATH>'
```

## 8. Microsoft Store sync ve MSIX

Store ağacı `D:\Projects\nebula-store` Git repository değildir. Bu nedenle kaynak eşitleme geri alınabilir ve denetlenebilir yapılmalıdır.

- [ ] Store hedefinin zaman damgalı yedeği alındı.
- [ ] Normal repo ile Store ağacı dosya bazında sınıflandırıldı.
- [ ] Yalnızca güvenli ortak source dosyaları kopyalandı.
- [ ] Store'a özel `Package.appxmanifest`, identity, updater-free config, signing ve packaging dosyaları korunuyor.
- [ ] Updater kodu/izinleri Store build'ine yanlışlıkla girmedi.
- [ ] `npm.cmd run audit:store-updater-free` geçti.
- [ ] Store source parity bağımsız hash/diff ile doğrulandı.
- [ ] MSIX temiz Store tree'den üretildi.
- [ ] MSIX içindeki executable version ve source commit kaydı doğrulandı.
- [ ] Package identity, publisher, architecture ve version manifest ile eşleşiyor.
- [ ] MSIX signature doğrulandı.
- [ ] WACK sonucu PASS ve rapor saklandı.
- [ ] Partner Center submission doğru package/flight üzerinde açıldı.
- [ ] Certification sonucu kontrol edildi.
- [ ] Publication/availability ayrıca doğrulandı; certification publication sayılmadı.

## 9. Final release kanıtı

Release tamamlandı denmeden önce şu değerleri tek yerde kaydet:

| Kanıt | Değer |
| --- | --- |
| Release version | `<NEXT_VERSION>` |
| Source commit SHA | `<SHA>` |
| Git tag ve remote SHA | `<TAG / SHA>` |
| Frontend regression | `<PASS/TOTAL>` |
| Rust tests | `<PASS/FAIL/IGNORED>` |
| E2E | `<PASS veya açık waiver>` |
| Installer adı | `<FILE>` |
| Installer SHA-256 | `<HASH>` |
| Installer signature | `<VALID/INVALID>` |
| Updater manifest URL | `<URL>` |
| MSIX adı | `<FILE>` |
| MSIX SHA-256 | `<HASH>` |
| WACK | `<PASS/FAIL>` |
| Partner Center | `<STATUS>` |

- [ ] `docs/CURRENT_STATE.md` yeni doğrulanmış durumla güncellendi.
- [ ] Açık blocker ve waiver'lar görünür biçimde kaydedildi.
- [ ] Release'in gerçekten erişilebilir olduğu uzaktan doğrulandı.

## Başarısızlık ve rollback ilkeleri

- Mevcut kullanıcı değişikliklerini kurtarmak için destructive Git komutları kullanma.
- Başarısız artifact'i aynı version/tag altında sessizce değiştirme.
- Updater manifest'i erişilemeyen veya imzası doğrulanmamış dosyaya yöneltme.
- Store sync başarısızsa yedekten geri dönüş hedefleri açıkça doğrulanmadan toplu silme/taşıma yapma.
- Bir gate kırmızıysa release durumunu `NO-SHIP`, `WAIVED` veya `BLOCKED` olarak açıkça yaz; yeşil görünmesi için kanıtı yumuşatma.
