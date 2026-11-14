# Gizlilik denetimi: tarayıcının kendi ağ trafiği

Bu belge, Nebula açıkken ve hiçbir sayfa açık değilken **tarayıcının kendisinin** (sayfaların değil) nereye bağlandığını ölçer. Amaç "Microsoft'a ya da
başkasına kendiliğinden ne gidiyor?" sorusuna ölçümle cevap vermek. Ölçüm aracı `scripts/webview2-net-audit.ps1` (+ `.mjs`); yöntem sonda.

## Son ölçüm

- Tarih: 2026-11-14. Derleme: `feature/shield-engine` dalı, `b477b27` üzerindeki çalışma ağacı (shield açık, varsayılan ayarlar: zararlı site listesi güncellemesi
  KAPALI, parmak izi koruması KAPALI), ayrı kimlikli (`com.nebula.browser.perf`) derleme ve kendi profili.
- Süre: 360 sn, hiçbir sayfa açılmadan boşta.
- WebView2 ağ günlüğü (`--log-net-log`): 2517 olay.

| Sahip | Host | İstek | Tarayıcının kendisi | Ne için |
|---|---|---|---|---|
| Microsoft | `edge.microsoft.com` | 1 | 1 | `/componentupdater/api/v1/update`: WebView2'nin bileşen güncelleyicisi (60. saniyede) |
| Yerel | `ipc.localhost` | 1 | 0 | Nebula'nın kendi arayüzü ile uygulaması arasındaki yerel iletişim (ağa çıkmaz) |

DNS'e sorulup istek gitmeyen tek ad: `wpad` (Windows'un vekil keşfi, WebView2'den değil sistemden).

**Sonuç:** boştayken ağa çıkan tek şey Microsoft'un bileşen güncelleyicisine tek bir istek. Reklam/izleyici engelleme için ağdan hiçbir şey çekilmedi
(listeler uygulamayla gelir); Google, Bing, telemetri ya da başka bir üçüncü tarafa istek görülmedi.

## Bu sonuç neyi söylemez

- Yalnızca **boşta 6 dakika** ölçüldü. Bir sayfa açıldığında sayfanın kendi istekleri (ve onların üçüncü tarafları) elbette gider; bunlar bu belgenin konusu
  değil. Shield'in sayfa isteklerini nasıl etkilediği `scripts/shield-measure-run.mjs` ile ölçülür (`docs/SHIELD.md`).
- Nebula'nın kendi güncelleme denetimi bu 6 dakikada görülmedi. Kurulu uygulamanın güncelleme denetimi ayrıdır ve `PRIVACY.md`'de anlatılır; bu ölçüm
  kurulu sürümü değil ayrı kimlikli bir derlemeyi kapsar.
- Giriş (Google hesabı), senkronizasyon, bildirimler, parolalar, uzantılar, "zararlı site listesini güncel tut" anahtarı (açıkken `malware-filter.gitlab.io`'ya
  en fazla 12 saatte bir tek istek gider) ve ilk çalıştırma ölçülmedi.
- Microsoft'a giden o tek isteği Nebula kapatmıyor: bileşen güncelleyici WebView2'nin (Edge) kendi çalışma biçimi. Kapatmak (örneğin `--disable-component-update`)
  Widevine ve benzeri bileşenlerin güncellenmesini de keser; bu yüzden denenmedi.

## Yöntem

```powershell
powershell -File scripts/webview2-net-audit.ps1 -Exe <ayrı kimlikli exe> -Minutes 6 -OutDir <boşluksuz klasör>
```

Betik WebView2'yi `--log-net-log` ile başlatır, belirtilen süre dokunmaz, kapatır ve `scripts/webview2-net-audit.mjs` günlüğü okur: her host için isteği
tarayıcının mı yoksa bir sayfanın mı yaptığını, sahibini (Microsoft, Google, yerel, diğer) ve ilk/son saniyeyi söyler. Kurulu Nebula'nın çalışıyor olması
ölçümü bozar (tek örnek devri); ayrı kimlikli bir derleme kullanılmalıdır.
