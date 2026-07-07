# Nebula Browser — Özellik Envanteri

> **Son güncelleme:** 5 Temmuz 2026  
> **Aşama:** UI Prototype (v0.1)  
> **Stack:** Vite + React + TypeScript

Bu dosya, projede **şu anda var olan** tüm özellikleri, **bugün yapılan** değişiklikleri ve **ayarlarda kişiselleştirilecek** hedefleri kayıt altına alır. Önerilen gelecek özellikler dosyanın sonunda ayrı bir bölümdedir.

---

## Bugün yapılanlar (5 Temmuz 2026)

- Semi-lunar **peek (küçük hilal) aşaması kaldırıldı** — browsing modunda üste gelince doğrudan tam menü açılır.
- **Açılış animasyonu:** üst ortadan `scale(0.2, 0.14)` → `scale(1)` büyüme + opacity (260 ms, hafif spring).
- **Kapanış animasyonu:** ters scale + opacity (140 ms).
- **Kapanma gecikmesi:** fare menüden çıkınca 200 ms bekleyip kapanır (~340 ms toplam).
- Animasyon easing/süreleri `tokens.css` içinde `--lunar-*` değişkenlerine taşındı.
- **Ana sayfada semi-lunar her zaman tam açık** — hover gerekmez, mouse çıkınca kapanmaz.

---

## Görünüm modları

| Mod | Açıklama |
|-----|----------|
| **home** | Ana ekran: duvar kağıdı, semi-lunar (açık), arama, sol widget'lar, sağ araç çubuğu |
| **browsing** | Tam ekran iframe + üstte hover ile açılan semi-lunar menü |
| **overlay** | Bulanık site arka planı + minimal arama + sağ toolbar + ana sayfa (ev) butonu |

### Geçişler

- Kısayol veya arama → `browsing` (iframe yüklenir).
- Browsing'de semi-lunar'daki **grid butonu** → `overlay`.
- Overlay'de **✕** veya backdrop tıklama / `Escape` → `browsing`.
- Overlay'de **ev ikonu** → `home`.
- `activeUrl` null değilse tarayıcı iframe'i gösterilir.

---

## Semi-Lunar Menü

### Davranış

| Ortam | Davranış |
|-------|----------|
| Ana sayfa | Menü **sürekli tam açık** (`expanded`), kapanmaz |
| Browsing | Üst tetik bölgesine hover → tam menü açılır; mouse çıkınca 200 ms sonra kapanır |
| Overlay | Menü gizli (`mode === 'overlay'` → render yok) |

### Görsel

- Gri cam efekti: `rgba(100, 100, 105, 0.8)` + yoğun `backdrop-filter` blur
- Hilal formu: ellipse clip-path, çift katmanlı arc stroke (gradient)
- Boyut: ~1100×152 px (`--lunar-width`, `--lunar-height`)

### Animasyon sabitleri (`src/styles/tokens.css`)

| Değişken | Değer | Açıklama |
|----------|-------|----------|
| `--lunar-duration-open` | 260 ms | Açılış süresi |
| `--lunar-duration-close` | 140 ms | Kapanış süresi |
| `--lunar-duration` | 140 ms | Genel kısayol geçişleri |
| `--lunar-ease-open` | `cubic-bezier(0.34, 1.18, 0.64, 1)` | Açılış easing (hafif spring) |
| `--lunar-ease-close` | `cubic-bezier(0.4, 0, 0.2, 1)` | Kapanış easing |
| `--lunar-scale-x` | 0.2 | Açılış başlangıç genişlik oranı |
| `--lunar-scale-y` | 0.14 | Açılış başlangıç yükseklik oranı |

### Zamanlama sabitleri (`SemiLunarMenu.tsx`)

| Sabit | Değer | Açıklama |
|-------|-------|----------|
| `CLOSE_DELAY_MS` | 200 | Mouse leave sonrası kapanma gecikmesi |
| `PREVIEW_DELAY_MS` | 1000 | Hover önizleme gecikmesi |
| `CLOSE_BTN_DELAY_MS` | 300 | Kısayol üzerinde ✕ butonu gecikmesi |
| `FOLDER_MERGE_HOLD_MS` | 650 | Klasör birleştirme için üzerinde tutma süresi |
| `MERGE_ANIM_MS` | 420 | Birleştirme animasyonu süresi |

### Browsing özel

- **Ev/grid butonu** (sol üst): overlay menüsünü açar (`onHomeClick`).
- Klasör paneli veya context menu açıkken menü kapanmaz; ikisinden de çıkınca `scheduleClose` devreye girer.

---

## Kısayollar (Semi-Lunar dock)

### Varsayılan set

12 site: Google, YouTube, Reddit (×2), Twitter/X, Netflix, Wikipedia (×2), Notion, Spotify, GitHub, LinkedIn (`src/core/constants.ts`).

### Etkileşimler

- **Tıklama:** siteye git (`onNavigate` → browsing).
- **Sürükle-bırak:** canlı takip, hilal elips sınırı içinde (`clampToLunarDome`), çarpışma çözümü.
- **Sağ tık menüsü:** Yeni sekmede aç, Sessize al / Sesi aç, Kapat.
- **Hover etiketi:** sağ alt köşede uygulama adı.
- **✕ kapatma:** hover 300 ms sonra sağ üstte kırmızı buton; kısayolu gizler (silmez, prefs'e `removed` olarak kaydedilir).
- **Sessize al:** yarı saydam + kırmızı çizgi overlay.

### Hover önizleme

- Ayar açıksa kısayol üzerinde **1 sn** bekleyince tam ekran soluk site önizlemesi (`ShortcutPreviewOverlay`).
- Önizleme aktifken ana sayfa chrome'u ve browsing iframe gizlenir.
- Ayar: **Ayarlar → Semi-Lunar → Hover önizleme** (`nebula-preview-on-hover`).

### Klasör sistemi

- İki kısayolu üst üste sürükleyip **650 ms** tutunca hedef küçülür; mouse bırakınca klasör oluşur.
- Mevcut klasöre sürükleyerek üye ekleme.
- Klasör ikonu: 2×2 mini favicon grid.
- Klasöre tıklayınca `FolderExpandPanel` açılır.
- Klasör adı panelde tıklanarak düzenlenebilir.
- Panelden ikonu dışarı sürükleyerek dock'a geri alma.
- Klasör + semi-lunar: panel veya menü üzerindeyken açık kalır.

### Konumlandırma

- Varsayılan: iki sıra hilal elips üzerinde (`buildDefaultPositions`).
- Özel konumlar `localStorage` → `nebula-shortcut-positions-v7`.
- Sıfırlama: Ayarlar → Ana Sayfa → Kısayolları sıfırla (pozisyonlar + klasörler + varsayılan liste).

---

## Ana sayfa

### HomeCenter

- Ortada cam efektli **arama çubuğu** (URL veya Google araması).
- Profil alanı: avatar + “Tekrar hoş geldin {kullanıcı}” (`DEFAULT_USER.name` = `memir`).
- Overlay varyantında sadece arama (profil gizli), `autoFocus` aktif.

### LeftSidebar

- **RAM** ve **CPU** widget'ları + sparkline grafik (mock veri, `useSystemStats`).
- Canlı **saat ve tarih** (`useClock`).
- İki adet “+” widget ekleme butonu (henüz işlevsiz).

### WallpaperBackground

- Özel duvar kağıdı yükleme (sağ toolbar connectivity / wallpaper picker).
- `localStorage` → `nebula-wallpaper`.
- Kısayol önizlemesi aktifken gizlenir.

### RightToolbar

- **⚙ Ayarlar** — bounce animasyonlu ayar paneli (gear anchor'dan açılır).
- **🔔 Bildirimler** — placeholder (badge: 2).
- **⛨ Gizlilik** — placeholder.
- **◎ Connectivity** — duvar kağıdı seçici (`onWallpaper`).

---

## Ayarlar paneli

Boyut: ~1060×720, ortalanmış, portal ile render.

### Kategoriler

| Kategori | Durum | İçerik |
|----------|-------|--------|
| **Görünüm** | Kısmen aktif | Duvar kağıdı seçimi; tema “Yakında” |
| **Ana Sayfa** | Kısmen aktif | Kısayolları sıfırla; sistem widget'ları “Yakında” |
| **Semi-Lunar** | Aktif | Hover önizleme toggle |
| **Gizlilik** | Placeholder | Gecko sonrası |
| **Bildirimler** | Placeholder | Yakında |
| **Hakkında** | Aktif | v0.1, yol haritası metni |

---

## Kalıcı veri (localStorage)

| Anahtar | İçerik |
|---------|--------|
| `nebula-wallpaper` | Duvar kağıdı data URL |
| `nebula-preview-on-hover` | Boolean — hover önizleme |
| `nebula-shortcut-preferences-v1` | `{ muted: [], removed: [] }` |
| `nebula-shortcut-folders-v1` | `{ folders: ShortcutFolder[] }` |
| `nebula-shortcut-positions-v7` | `ShortcutPosition[]` |

---

## Kod tabanında var, ana shell'e bağlı değil

Bu bileşenler mevcut ancak `BrowserShell` içinde henüz kullanılmıyor:

- **SpatialGrid** — sürüklenebilir/yeniden boyutlandırılabilir workspace ızgarası
- **AmbientBackground** — ambient gradient arka plan
- **useSpatialLayout** / **useMenuState** — grid ve menü state hook'ları

---

## Yol haritası (README)

| Faz | Kapsam | Durum |
|-----|--------|-------|
| 1 | Tam UI prototype (React + Vite + iframe) | Tamamlandı |
| 2 | Tauri frameless native shell | Devam ediyor |
| 3 | Gerçek WebView gezintisi (Tauri + WebView2/WebKit) | Tauri sonrası |
| 4 | Gizlilik katmanı (WebView sınırları içinde) | Sonra |
| 5 | LLM bellek yönetimi + RAM optimizasyonu | Sonra |

> Gecko/Firefox motoru orijinal vizyon olarak ertelendi; masaüstü için Tauri + sistem WebView kullanılıyor.

---

## Kişiselleştirme hedefi

> **Hedef:** Aşağıdaki tüm davranış ve görünüm ayarları ileride **Ayarlar** panelinden değiştirilebilir olacak. Şu an kodda sabit veya kısmen ayarlanabilir olanlar işaretlendi.

### Görünüm → planlanan ayarlar

| Ayar | Şu anki durum | Varsayılan |
|------|---------------|------------|
| Duvar kağıdı | ✅ Aktif | — |
| Tema (açık/koyu/özel) | ❌ Yakında | Koyu |
| Cam blur yoğunluğu | 🔒 Sabit (`--glass-blur`) | 22px |
| Cam opaklığı / renk | 🔒 Sabit | Forest glass paleti |
| Accent / gold renkleri | 🔒 Sabit (`tokens.css`) | Nebula paleti |
| Semi-lunar cam rengi | 🔒 Sabit | `rgba(100,100,105,0.8)` |
| Semi-lunar boyutu | 🔒 Sabit | 1100×152 px |

### Ana Sayfa → planlanan ayarlar

| Ayar | Şu anki durum | Varsayılan |
|------|---------------|------------|
| Sistem widget'ları göster/gizle | ❌ Yakında | Açık |
| RAM/CPU widget seçimi | ❌ Yok | RAM + CPU |
| Saat widget'ı | 🔒 Her zaman açık | — |
| Karşılama mesajı / kullanıcı adı | 🔒 Sabit | `memir` |
| Arama motoru | 🔒 Google | Google |
| Kısayolları sıfırla | ✅ Aktif | — |
| Spatial grid düzeni | ❌ Bağlı değil | — |

### Semi-Lunar → planlanan ayarlar

| Ayar | Şu anki durum | Varsayılan |
|------|---------------|------------|
| Ana sayfada her zaman açık | 🔒 Sabit (açık) | Açık |
| Browsing'de hover ile aç | 🔒 Sabit | Açık |
| Açılış animasyon süresi | 🔒 `--lunar-duration-open` | 260 ms |
| Kapanış animasyon süresi | 🔒 `--lunar-duration-close` | 140 ms |
| Kapanma gecikmesi | 🔒 `CLOSE_DELAY_MS` | 200 ms |
| Açılış scale başlangıcı | 🔒 `--lunar-scale-x/y` | 0.2 / 0.14 |
| Açılış easing (spring miktarı) | 🔒 CSS değişkeni | Hafif spring |
| Hover önizleme | ✅ Toggle | Açık |
| Önizleme gecikmesi | 🔒 `PREVIEW_DELAY_MS` | 1000 ms |
| ✕ butonu gecikmesi | 🔒 `CLOSE_BTN_DELAY_MS` | 300 ms |
| Klasör birleştirme tutma süresi | 🔒 `FOLDER_MERGE_HOLD_MS` | 650 ms |
| İkon boyutu | 🔒 `ICON_SIZE` | 44 px |
| Hilal genişliği / yüksekliği | 🔒 CSS değişkeni | 1100 / 152 |

### Gizlilik → planlanan ayarlar (Gecko sonrası)

| Ayar | Durum |
|------|-------|
| Takip engelleme | Placeholder |
| Çerez politikası | Placeholder |
| HTTPS zorunluluğu | Placeholder |
| Fingerprint koruması | Planlanmadı (kod yok) |

### Bildirimler → planlanan ayarlar

| Ayar | Durum |
|------|-------|
| Odak modu uyarıları | Placeholder |
| Site bildirimleri | Placeholder |
| Sağ toolbar badge | Mock (2) |

---

## Önerilen gelecek özellikler

Aşağıdakiler şu an kodda yok; ürün vizyonuna ve mevcut yapıya göre eklenmesi mantıklı görünen önerilerdir.

### Semi-Lunar & kısayollar

- **Peek modu toggle** — isteyen kullanıcı için küçük hilal → tam menü iki aşamalı açılış (bugün kaldırıldı, ayar olarak geri gelebilir).
- **Yeni kısayol ekleme** — URL yapıştır / sık kullanılanlardan seç.
- **Kısayol sıralama modları** — manuel, alfabetik, kullanım sıklığına göre.
- **Klasör renk/etiket** — görsel ayırt etme.
- **Klasör içi sıralama** — sürükle-bırak ile üye sırası.
- **Çoklu sekme önizlemesi** — hover'da son ziyaret edilen sayfa thumbnail (Gecko sonrası).
- **Semi-lunar konumu** — üst orta (şimdi), üst sol/sağ veya kenar dock seçenekleri.

### Ana sayfa & düzen

- **Spatial Grid entegrasyonu** — ana ekranda özelleştirilebilir widget alanı.
- **Widget kataloğu** — hava, takvim, notlar, pomodoro, ağ hızı.
- **Gerçek sistem istatistikleri** — Tauri/native API ile RAM/CPU.
- **Çoklu duvar kağıdı** — günün saatine göre otomatik geçiş.
- **Odak modu** — sadece arama + minimal UI.

### Tarayıcı & gezinme

- **Sekme yönetimi** — browsing modunda gerçek sekmeler (Gecko `<browser>`).
- **Geri / ileri / yenile** — overlay veya semi-lunar'a entegre.
- **Adres çubuğu senkronu** — iframe URL'sini gösterme.
- **Tam ekran / PiP** — video siteleri için.

### Ayarlar & erişilebilirlik

- **Tüm timing/easing değerleri için UI slider'ları** — geliştirici modu veya “Gelişmiş animasyon”.
- **Animasyonları azalt** — `prefers-reduced-motion` desteği.
- **Klavye kısayolları** — semi-lunar'ı `Alt+Space` ile açma vb.
- **Dil seçimi** — TR/EN arayüz.
- **Ayarları dışa/içe aktar** — JSON profil dosyası.

### Gizlilik & güvenlik

- **İzleyici listesi** — uBlock benzeri katman (Gecko Necko hook).
- **Otomatik çerez temizleme** — sekme kapanınca.
- **HTTPS-Only modu**.
- **Site izinleri paneli** — kamera, konum, bildirim.

### Sosyal & senkron

- **Cihazlar arası kısayol/klasör senkronu** — şifreli uçtan uca.
- **Paylaşılan klasörler** — aile/ekip kısayol setleri.

### Performans

- **Önizleme kalitesi / devre dışı** — düşük RAM modunda hover önizlemeyi kapat.
- **Lazy favicon yükleme** ve önbellek.

---

## Aktif klavye kısayolları

| Tuş | Bağlam |
|-----|--------|
| `Enter` | Arama gönder; klasör adı kaydet |
| `Escape` | Overlay'den çık; ayarları kapat; bağlam menüsünü kapat; klasör panelini kapat |
| `Escape` (klasör adı düzenlerken) | Düzenlemeyi iptal |

---

## Hızlı referans — dosya haritası

```
src/
├── components/
│   ├── BrowserShell/       # Ana orchestrator (viewMode)
│   ├── SemiLunarMenu/      # Üst hilal menü + kısayollar + klasörler
│   ├── SettingsPanel/      # Ayarlar
│   ├── HomeCenter/         # Arama + profil
│   ├── LeftSidebar/        # Sistem widget'ları
│   ├── RightToolbar/       # Sağ aksiyonlar
│   ├── WallpaperBackground/
│   ├── SpatialGrid/        # (henüz bağlı değil)
│   └── AmbientBackground/  # (henüz bağlı değil)
├── hooks/                  # Tercihler, klasörler, pozisyonlar, wallpaper
├── core/                   # Tipler, sabitler, hilal geometrisi, drop hedefi
└── styles/tokens.css       # Tasarım token'ları
```

---

*Bu belge canlı tutulmalıdır: yeni özellik eklendikçe veya ayarlar paneline taşındıkça güncellenir.*
