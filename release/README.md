# Nebula Release Build

İmzalı Windows kurulum paketini ve Tauri updater manifestini proje kökünden üretin:

```powershell
.\scripts\publish-release.ps1 -Version 1.0.0 -Notes "Nebula'nın ilk kararlı sürümü"
```

Çıktılar `release/` klasörüne yazılır. Kurulum dosyaları Git tarafından izlenmez;
`latest.json` ise updater istemcilerinin doğrulayabilmesi için sürüm commit'ine eklenir.
