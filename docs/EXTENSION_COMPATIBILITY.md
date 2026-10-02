# Eklenti uyumluluk kontrolleri

Bu sistem üç ayrı kanıt üretir. Hiçbir ön inceleme sonucu kendiliğinden “tam uyumlu” veya “güvenli” anlamına gelmez.

**İndir** artık her katalog kartında bu akışı otomatik çalıştırır: paket alınır, manifest/dosya kontrolü yapılır, ayrı geçici WebView2 profilinde yükleme → etkinlik/listelenme → kaldırma denenir ve test penceresi kapatılır. Ancak bundan sonra paket İndirilenler'e tamamlanmış dosya olarak yazılır. Sonuç ve gerçek manifest uyarıları kartta görünür. Hata veya zaman aşımı başarılı indirme sayılmaz. Doğrudan **Kur** işlemi de aynı otomatik denemeyi geçmek zorundadır.

Kayıtlı iki paket sabit sürüm ve SHA-256 ile doğrulanır. Diğer katalog kartları Google'ın HTTPS Chrome Web Store güncelleme hizmetinden CRX3 olarak indirilir; CRX3 başlığındaki mağaza kimliği katalogdaki kimlikle eşleşmelidir, Manifest V3 ve tüm yerel dosya referansları geçerli olmalıdır. Bu ikinci yol sabit hash'li bir güvenlik sertifikası veya kalıcı kurulum değildir: indirme anındaki gerçek mağaza paketinin yüklenebildiğini kanıtlar. Her iki yol da test profilini kaldırır; katalog kartındaki başarılı sonuç kullanıcının normal profiline eklenti kurmaz.

1. **Katalog ön incelemesi:** Her kaydın manifest sürümü, minimum motor sürümü, gerekli/isteğe bağlı izinleri ve site erişimi değerlendirilir. Native messaging, hesap girişi, Nebula sekmeleri/tarayıcı entegrasyonu ve bilinmeyen izinler ayrı bulgulardır. Geniş erişim bir izin bilgisidir; tek başına uyumsuzluk sebebi sayılmaz. Masaüstü UI, gerçek WebView2 ortamından motor sürümünü bir kez okur. Okunamazsa sürüm karşılaştırması yapılmış sayılmaz.
2. **Gerçek paket:** Kayıtlı paketlerin SHA-256 ve kimlik/sürüm kontrolünden sonra ZIP sınırları, dosya yolları, Windows dosya çakışmaları, manifest alanları, worker/content script/popup/options/devtools/ikon/DNR dosya referansları kontrol edilir. Keşif paketleri için Google CRX3 başlık kimliği aynı kontrollerden önce katalogdaki mağaza kimliğiyle karşılaştırılır. Üretim kurulumu bu denetimi ve gerçek runtime minimum sürüm denetimini eklenti çalıştırılmadan uygular. Popup/yan panel gibi gereksinimler gerçek manifest analizinde ayrıca raporlanır. Bu, bütün JavaScript bağımlılıklarını veya uzaktaki hizmetleri doğrulayan bir analiz değildir.
3. **Gerçek WebView2 testi:** Geçici ayrı profilde indirilen paket yüklenir, etkinlik ve listelenme doğrulanır, sonra kaldırılır. Paket sürümü, SHA-256 ve gerçek runtime sürümü kart sonucuna yazılır. Dark Reader için kayıtlı pakete ek olarak yerel HTTP sayfasını gerçekten karartma kontrolü vardır. Diğer işlevler, özellikle SponsorBlock'un gerçek videoda sponsor atlaması, bu testle doğrulanmaz.

Microsoft, eklentinin kurulduktan hemen sonra çalıştığını ve WebView2'nin popup/ikon gibi bazı tarayıcı giriş noktalarını sağlamadığını açıklar: [AddBrowserExtension](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile7?view=webview2-1.0.4022.49). Bu yüzden ön kontrol kullanıcı profiline deneme kurulumu yapmaz; gerçek çalışma testi ayrı profildedir. Geçici profil bir güvenlik sandbox'ı değildir: test, indirilen uzantı kodunu çalıştırır; fark, tüm profil verisinin ve kaydın test bitince silinmesidir.

## Çalıştırma

Repo kökünde, ağ isteği ve Crawlora kredisi harcamadan 200 kaydı incele:

```powershell
npm.cmd run extensions:check
```

Varsayılan rapor motor sürümü bilinmiyor olarak başlar. Gerçek WebView2 sürümüyle karşılaştırmak için:

```powershell
npm.cmd run extensions:check -- --runtime-version 150.0.0.0
```

Buradaki sürüm örnektir; gerçek sürümü `runtime.json` raporundan al. `candidate` yalnız statik engel bulunmadığı anlamına gelir; çalıştırma testi hâlâ gereklidir. `review` inceleme/çalışma testi gerektiğini, `blocked` bilinen bir engel bulunduğunu belirtir. Mağaza metadatası tam manifest değildir.

Genel kural regresyonları:

```powershell
node --test --experimental-strip-types tests/extension-compatibility.test.ts tests/extension-catalog.test.ts
```

`src-tauri` içinde gerçek, yerelde önbelleğe alınmış paketleri kontrol et:

```powershell
cargo test --offline --lib extension_install::tests::cached_registry_compatibility_report -- --ignored --exact --nocapture
```

Ön koşul: `target/extension-download-smoke` içinde `extensionPackages.json` kayıtlarına karşılık gelen resmi ZIP dosyaları bulunmalıdır. Test dosyaları SHA-256 ile yeniden doğrular. Eksik/değiştirilmiş dosya testi başarısız yapar; ağa otomatik çıkılmaz. Önceki indirme testiyle bunlar alınabilir:

```powershell
cargo test --offline --lib extension_download::tests::official_registry_download_round_trip -- --ignored --exact --nocapture
```

Bu son komut gerçek ağ indirmesi yapar; `--offline` yalnız Cargo bağımlılık çözümlemesine uygulanır.

Repo kökünde paket analizini rapora dahil et:

```powershell
npm.cmd run extensions:check -- --packages src-tauri/target/extension-compatibility/packages.json
```

Tek bir gerçek manifest'i de inceleyebilirsin:

```powershell
npm.cmd run extensions:check -- --manifest C:\path\to\manifest.json
```

Bu seçenek dosya içeriğini inceler; ZIP hash/dosya kontrolü veya eklenti çalıştırması yapmaz.

Windows masaüstü oturumunda, `src-tauri` içinde gerçek runtime testi:

```powershell
cargo test --offline --features extension-native-smoke extension_install::tests::native_install_status_remove_round_trip -- --ignored --exact --nocapture
```

Bu test sabit iki pakete ek olarak Adobe Acrobat'ın gerçek Chrome Web Store CRX paketini indirir; ağ erişimi gerekir. `--offline` burada yalnız Cargo bağımlılık çözümlemesine uygulanır.

Üretilen raporlar `src-tauri/target/extension-compatibility/` altındadır:

Native test başlangıç dahil 90 saniyede tamamlanamazsa test süreci hata ile sonlanır; sonuç başarılı olarak işaretlenmez. Kısıtlı Windows job ortamında WebView oluşturma takılabiliyorsa normal masaüstü oturumunda aynı geçici profilli test kullanılmalıdır.

- `report.md` / `report.json`: tüm katalog ve verilmişse gerçek manifest ön incelemesi.
- `packages.json`: hash'i kontrol edilen kayıtlı ZIP'lerden manifest ve paket kontrol kanıtları.
- `runtime.json`: tam paket sürümü/hash ve WebView2 sürümüne bağlı gerçek yükleme/etkinlik/kaldırma sonucu. Test başında durum `running` olur; yalnız tüm kontroller geçince `passed` yazılır. Eski rapor yeni sürümün kanıtı değildir.

Katalogdaki 200 kayıt otomatik incelenir ve karttan indirildiğinde aynı gerçek paket/runtime yolundan geçirilir. İndirilen manifest ve izinler kullanıcıya gösterildikten sonra, onaylanan SHA-256 değişmediyse katalog paketi ayrı bir kalıcı deneme profiline kurulabilir. Bu profil normal Nebula sekmelerinden ve özel sekmelerden ayrıdır. Semi-Lunar eklenti menüsü kurulu kayıtları listeler; statik popup/options sayfalarını, etkinleştirme/devre dışı bırakma/kaldırma işlemlerini ve seçili siteyi deneme profilinde açmayı sunar.

Sabit hash'li `extensionPackages.json` kayıtları normal Nebula profili için önceki kurulum yolunu korur. Katalog paketleri Google'ın izin verilen update hostundan her kurulumda tekrar alınır ve kullanıcının incelediği indirme digest'iyle eşleşmezse yeni inceleme istenir. CRX3 imzası bağımsız kriptografik olarak doğrulanmadığı için bu akış güvenlik sertifikası olarak tanımlanmaz.

2026-09-12 native host deneyi WebView2 `152.0.4191.66` üzerinde sahip olunan MV3 fixture ile content script, popup origin, service worker mesajı, `storage.local`, `tabs.query`, enable/disable/remove işlemlerini geçti. Popup WebView açıkken `tabs.query({active:true,lastFocusedWindow:true})` test sitesini döndürdü. Bu kanıt dinamik `action.onClicked`, dinamik popup, sidePanel, nativeMessaging, identity veya gerçek paketlerin bütün işlevlerini doğrulamaz. Ayrıntılı mimari karar ve kaynaklar için [EXTENSION_HOST_RESEARCH.md](EXTENSION_HOST_RESEARCH.md) belgesine bak.
