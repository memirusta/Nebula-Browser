# Nebula iyileştirme raporu — 2026-09-09

İnceleme ve değişiklikler `D:\Projects\nebula` ana Windows ağacında yapıldı. Başlangıç commit'i `ff2597242bb2dae9ff38251587af384268170c80`, branch `main`, sürüm `1.8.5`; çalışma ağacı başlangıçta temizdi. Kullanıcı UI, frontend ve backend geliştirmelerini bulgular bildirilerek yapmamıza izin verdi.

## Uygulanan düzeltmeler

### 1. İptal düğmesinde Enter işlemi onaylıyordu

AppDialog, parola kaydet/doldur ve site izin pencerelerinde parent `onKeyDown`, alt düğmeden gelen Enter'ı da onay olarak işliyordu. İptal'e odaklanıp Enter basmak geçmişi silebiliyor veya parola işlemini çalıştırabiliyordu.

Düğmelerin kendi native aktivasyonu korundu. Site giriş alanlarında text/password Enter gönderimi korunuyor; IME composition ve boş basic-auth kullanıcı adı gönderilmiyor. TabSearch'te arama klavye kısayolları yalnız arama alanından gelen olayları işliyor; kapat/sessiz düğmeleri kendi eylemini yapıyor.

Kaynaklar: `AppDialogHost.tsx`, `PasswordSavePrompt.tsx`, `PasswordFillPrompt.tsx`, `SiteUiPrompt.tsx`, `TabSearch.tsx`.

### 2. Üst üste pencerelerin focus trap'leri çakışıyordu

History/Settings ile bunların üstündeki onay diyaloğu aynı anda document capture dinleyicilerini çalıştırıyordu. Tab odağı ve Escape yanlış pencereye gidebiliyordu.

`modalFocusStack.ts` iki hook için ortak sahiplik sağlıyor. Yalnız üstteki aktif kayıt klavyeyi işler. Pencere kapanırken odak ancak kalan üst pencerenin içindeki geçerli hedefe geri döner.

### 3. Riskli indirme kararı dosya adına tıklayarak atlanabiliyordu

UI, `completed` kaydını `requiresConfirmation` değerine bakmadan açılabilir/sürüklenebilir yapıyordu. Native open yolu aktif WebView2 download operation'dan doğrudan dosya yolu alabiliyordu.

UI, onay bekleyen dosyanın açma ve sürükleme eylemlerini kapatıyor. Native open yalnız bitmiş kayıt listesini kullanıyor. İmza kontrolü veya native uyarı devam ederken eski bir payload da kaydı tamamlanmışlar listesine geçiremiyor. Sakla kararı veya güvenilir imza kontrolü sonrasında normal açma davranışı geri geliyor. Explorer'da dosyayı gösterme mevcut davranışını koruyor.

Kaynaklar: `DownloadManager.tsx`, `download_manager.rs`.

### 4. Google Sync parola geri yükleme yazma kuyruğunu atlıyordu

Ayrı load/save arasında eşzamanlı parola ekleme veya silme, eski snapshot tarafından ezilebiliyordu. Restore artık aynı renderer'daki `updatePasswordVault` kuyruğunda güncel kayıtları birleştiriyor.

Deterministik test, gerçek vault modülünü sentetik native depoyla çalıştırıyor. Eski restore akışı yalnız test belleğinde kullanıldığında ekleme/silme testleri 0/2; düzeltilmiş kaynak 2/2 geçti. Bu değişiklik ayrı renderer'lar arasındaki native transaction sorunlarını çözme iddiası taşımaz.

### 5. Favicon fallback'i tam sayfa adresini dış servise gönderiyordu

`faviconForUrl` artık credentials, path, query ve fragment yerine yalnız public origin gönderiyor. Yerel, geçersiz ve HTTP(S) dışı hedeflerde bundled ikon kullanılıyor. Ziyaret kısayolu ve bookmark import yolları da aynı korumaya bağlandı; public arama motoru/domain alias davranışı korundu.

Testler doğrudan helper yanında visit/import → tab reducer zincirini de kapsıyor. Mevcut depolanmış favicon URL'leri migrate edilmedi; bu değişiklik yeni üretilen URL'leri kapsıyor. Public siteler için Google favicon hizmeti kullanılmaya devam ediyor.

Kaynaklar: `browserTab.ts`, `shortcutFromUrl.ts`, `bookmarkImport.ts`.

### 6. Ağ boyut sınırları içerik tamamen okunduktan sonra uygulanıyordu

Ortak `http_response.rs` response gövdesini parça parça okuyup sınır aşımında duruyor. Google Sync success/error gövdesi 8 MiB, bildirim ikonları 1 MiB ile sınırlı. Content-Length olmayan chunked yanıtlar da kapsanıyor.

Gerçek loopback HTTP testleri tam sınırı kabul etmeyi, bir byte aşımında EOF beklemeden durmayı ve aşırı Content-Length'i gövde gelmeden reddetmeyi doğruladı.

## Devam turunda eklenenler

Özel sekmelerin kalıcı geçmiş/oturum kayıtlarına yazılması, wallpaper import/reset yarışı ve kısa penceredeki TabSearch seçim/kaydırma sorunları düzeltildi. Transfer deposu native belleğe taşındı; atomik durum geçişleri ve claim/iptal yarışının rollback öncesinde çözülmesi eklendi. Tamamlanma kaydını artık yalnız sonucu gözlemleyen kaynak temizliyor.

Kullanıcının ek isteğiyle şifre Göster/Kopyala/Düzenle eylemleri Windows Hello doğrulamasına bağlandı. Düzenleme formu yalnız doğrulama sonrası açılır ve eşzamanlı değişmiş kaydı ezmez. Seçili geçerli web adresi için mevcut dokuz dilde Yeni sekmede aç eylemi eklendi; özel sekmeden açılan yeni sekme özel kalıyor.

Sonraki UI turunda üç görünür iyileştirme eklendi: aktif özel sekme Semi Lunar içinde küçük bir kilit rozetiyle işaretleniyor ve TabSearch içinde de ayırt ediliyor; şifre kasası alan adına göre gruplanıyor, site/alan adı/kullanıcı adıyla aranıyor ve son güncellenme zamanını gösteriyor; onay bekleyen indirmeler kaynak alan adını ve açılmayı engelleyen kararı belirgin bir kartta gösteriyor. Bu son değişiklikler yalnız mevcut sekme/indirme durumunu sunar; özel mod ve riskli indirme güvenlik kapılarının davranışını değiştirmez.

Kullanıcı son regression çıktısında **228/228 geçti** bilgisini paylaştı ve testleri kendisinin çalıştırmasını istedi. Bu son UI turundan sonra yalnız production frontend build çalıştırıldı ve geçti. Native Hello ve sağ tık kullanıcı akışlarının canlı doğrulaması bekleniyor.

## İlk parti doğrulaması (son kaynak için geçerli değildir)

| Kontrol | Güncel sonuç |
| --- | --- |
| Frontend regression | 203/203 geçti |
| Rust tüm target testleri | 105 geçti, 0 başarısız, 1 interactive DPAPI ignored |
| Rust Clippy | Warning-as-error geçti |
| Rust format | Geçti |
| Frontend lint | Exit 0; 93 React ref/effect uyarısı mevcut |
| Production frontend | Geçti |
| UI/E2E | Son production frontend çıktısında PASS |
| x64 binary | Geçti; optimized build 2 dakika 36 saniye |
| Native pencere/stability | PASS; pencere açıldı, 5 saniye kararlı kaldı |

History onayının eski davranışı gerçek DOM/CDP üzerinde önce başarısız olarak tekrarlandı. Yeni akışta Tab/Shift+Tab, İptal Enter, Onayla Enter ve üst pencere Escape testi geçti. Harness'te Enter'a `text: '\r'` eklendi: event trace, önceki metinsiz olayın native button click üretmediğini gösterdi. Bu test düzeltmesi production'a taşınmaz.

Parola, site izin ve TabSearch düğmeleri için ayrı gerçek WebView2 E2E fixture çalıştırılmadı. Download güvenlik kapısı native durum testleri ve render edilmiş UI çıktısıyla doğrulandı; gerçek indirilen bir executable başlatılmadı. Google hesabına bağlanılmadı ve kişisel parola verileri okunmadı.

## Kalan doğrulama

Son kaynak için native kontroller, Windows Hello onay/iptal, seçili adreste sağ tık, özel sekme göstergesi, kasa arama/gruplama ve iki pencere arasında sekme taşıma kullanıcı tarafından doğrulanacak. Lint uyarıları ayrıca değerlendirilebilir.

## İlk parti artifact bilgisi (güncel kaynak çıktısı değildir)

Doğrulanan `src-tauri/target/x86_64-pc-windows-msvc/release/app.exe` **12.348.928 byte**, sürüm **1.8.5**. SHA-256: `D379873A87A577DBA6FE0A711271063FC94F8EF478DBA740A46A6A8B65489B58`. Native smoke sonrası normal Windows kullanıcı oturumunda açıldı: **PID 3704**, `Responding=True`.

Değişiklikler yerel çalışma ağacında. Commit, push, yeni sürüm, installer, imzalama veya yayın yapılmadı. `nebula-store` ve `nebula-linux` değiştirilmedi. Store senkronizasyonu yapılacaksa updater-free ve package identity ayrımları ayrı doğrulanmalıdır.
