# Nebula Release Build

İmzalı Windows kurulum paketini ve Tauri updater manifestini proje kökünden üretin:

```powershell
.\scripts\publish-release.ps1 -Version 1.0.0 -Notes "Nebula'nın ilk kararlı sürümü"
```

Çıktılar `release/` klasörüne yazılır ve Git tarafından izlenmez:

- `Nebula_<sürüm>_x64-setup.exe`: kurulum paketi
- `latest.json`: updater manifesti (sürüm, tarih, notlar, kurulum adresi ve imza)

İkisi de GitHub Release'e yüklenir; betik, yükleme komutunu çıktısının sonunda yazar. Updater istemcileri manifesti
depodan değil, release'e yüklenen kopyadan okur (`releases/latest/download/latest.json`). Bu yüzden `latest.json`
commit edilmez; betik her yayında yeniden üretir. Sürüm notları GitHub Releases sayfasındadır.
