// Loaded by a hidden webview with no IPC (shell_isolation.rs, clear_browsing_residue).
// After a switch into the split environment the browsing profile still holds the shell's
// old storage for Nebula's own origin. Extensions run in that profile, so it is cleared.
// The host learns that this finished from the navigation to about:blank#residue-cleared.
;(async () => {
  try {
    localStorage.clear()
    sessionStorage.clear()
    if (indexedDB.databases) {
      for (const database of await indexedDB.databases()) {
        if (database.name) indexedDB.deleteDatabase(database.name)
      }
    }
    if (self.caches) {
      for (const name of await caches.keys()) await caches.delete(name)
    }
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0].trim()
      if (name) document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    }
  } finally {
    location.replace('about:blank#residue-cleared')
  }
})()
