# Nebula repository instructions

Bu dosya repoda çalışan Codex ajanları için kalıcı çalışma kurallarını tanımlar. Güncel proje durumu için işe başlamadan önce `docs/CURRENT_STATE.md` dosyasını oku. Release veya Microsoft Store işi yapıyorsan ayrıca `docs/RELEASE_CHECKLIST.md` dosyasını izle.

## İletişim ve kapsam

- Kullanıcıyla Türkçe konuş; kod, API ve teknik kimlikleri doğal İngilizce adlarıyla bırak.
- İstenen kapsamı koru. Tanı veya denetim talebi kod değişikliği izni değildir; açıkça düzeltme veya geliştirme istendiğinde dar ve doğrulanabilir değişiklik yap.
- Emin olmadığın sonucu kesinmiş gibi sunma. Doğrulanan bulguyu, güçlü çıkarımı ve açık soruyu birbirinden ayır.
- Computer Use kullanma; kullanıcı özellikle isterse istisna uygulanabilir.

## Çalışma ağacını koruma

- Repo kirli olabilir. Mevcut tracked ve untracked değişiklikleri kullanıcıya ait kabul et; ilgisiz dosyaları değiştirme, silme veya yeniden biçimlendirme.
- `git reset --hard`, `git checkout --`, toplu stash veya eşdeğer geri döndürücü işlemleri kullanıcı açıkça istemedikçe kullanma.
- Kirli çalışma ağacında `git add .` ve `git add -A` kullanma. Yalnızca incelenmiş, amaçlanan dosyaları açık adlarıyla stage et.
- Commit, push, PR, tag, GitHub release, imzalama, MSIX üretme veya Partner Center yayını ancak kullanıcı açıkça istediğinde yapılır.
- Dosya değişikliklerinde `apply_patch` kullan. Arama için önce `rg` / `rg --files` tercih et; `node_modules`, `src-tauri/target`, üretilmiş paketler ve `store-release` çıktılarını geniş aramalardan hariç tut.

## Uygulama ve mimari sınırlar

- Nebula, Tauri 2 + React + WebView2 tabanlı Windows tarayıcısıdır. Semptomu maskelemek yerine mümkün olduğunca gerçek root cause'u ve kullanıcı akışını doğrula.
- Bir pencere veya WebView oluşturulması tek başına başarı değildir. Tab taşıma ve reparent akışlarında hedefin gerçekten ownership aldığını, başarısızlıkta source tab'ın çalışır kaldığını ve rollback'in atomik olduğunu doğrula.
- Native Tauri command eklenirse hem Rust `generate_handler!` kaydı hem de `src-tauri/permissions` altındaki izin kaydı kontrol edilmelidir.
- F11, fullscreen, focus ve window restore değişikliklerinde normal startup semantics bozulmamalıdır.
- Bildirimlerde authoritative payload'ı tercih et. Instagram için zengin sender/message/reaction içeriği yalnızca açık ve geometrik olarak doğrulanmış exact DM route'unda çıkarılır; inbox satırı veya geçici `Typing...` metni message body olarak scrape edilmez.
- Güvenlik ve gizlilik özelliklerini UI etiketine bakarak doğrulanmış sayma; gerçek davranışı ve ilgili native/config katmanını kontrol et.

## Doğrulama standardı

Windows PowerShell ortamında npm komutları için `npm.cmd` kullan.

Değişikliğin kapsamına göre ilgili kontrolleri çalıştır. Release adayı için temel sıra:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:regression
npm.cmd run test:e2e
npm.cmd run test:native-smoke
npm.cmd run release:preflight
npm.cmd run tauri:build:binary
```

Rust kontrolleri `src-tauri` dizininden çalıştırılır:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
```

- Test sayısı veya sonuçları değişebileceği için yalnızca o çalıştırmada görülen gerçek sonucu raporla.
- Build'in geçmesi gerçek kullanıcı akışının doğrulandığı anlamına gelmez; riskli akışı ayrıca smoke/regression veya elle doğrula.
- `npm.cmd run test:e2e` mevcut makinede Chrome 151 headless GPU sorunu nedeniyle kırmızı olabilir. `docs/CURRENT_STATE.md` içindeki kanıtı oku; düzeltilmeden veya açıkça waive edilmeden tüm release kapılarını yeşil sayma.
- Çalışan Nebula process'i release binary'sini kilitlerse kullanıcıdan izin almadan process'i kapatma. Audit için ayrı target dizini kullan veya kullanıcıdan uygulamayı kapatmasını iste.

## Release ve Store sınırları

- `v1.8.3` mevcut commit üzerinde zaten kullanılmıştır; aynı sürümü yeniden yayımlama. Sonraki sürüm kullanıcı kararıyla seçilir.
- Updater metadata (`release/latest.json`) yalnızca gerçek, imzalı ve uzakta doğrulanmış artifact bilgileriyle son aşamada güncellenir.
- `D:\Projects\nebula-store` ayrı, Git içermeyen Store ağacıdır. Senkronizasyondan önce kaynak/hedef dosyaları sınıflandır, hedefi yedekle ve Store'a özel identity, `Package.appxmanifest`, updater-free davranış, signing ve packaging ayarlarını koru.
- Build, WACK veya certification sonucu publication kanıtı değildir. Tag, release asset, hash, installer signature, MSIX ve Partner Center durumu bağımsız doğrulanır.

## Dokümantasyon bakımı

- `AGENTS.md` kalıcı kuralları içerir; changelog gibi büyütme.
- Branch, sürüm, açık blocker, test sonucu veya release durumu maddi biçimde değiştiğinde `docs/CURRENT_STATE.md` dosyasını tarih ve kanıtla güncelle.
- Release sürecinde `docs/RELEASE_CHECKLIST.md` maddelerini kanıt üretmeden tamamlanmış sayma.
