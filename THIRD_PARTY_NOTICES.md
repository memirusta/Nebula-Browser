# Third-party notices

## uBlock Origin Lite

Nebula bundles the official Microsoft Edge build of uBlock Origin Lite.

- Project: https://github.com/uBlockOrigin/uBOL-home
- Version: `2026.804.1652`
- Release asset: `uBOLite_2026.804.1652.edge.zip`
- Source archive SHA-256: `4cbfae11caf3a3a8d2e98d9c0844229d0ef7d1334785232d4fc667117a526193`
- License: GNU General Public License v3.0

Nebula applies a small integration patch that exempts its internal WebView2
application origins from network and cosmetic filtering. This prevents the
extension from treating the browser's own user interface as page content.
Nebula also enables uBO Lite's bundled experimental ruleset and registers its
generated YouTube scriptlets at document start to compensate for WebView2's
headless extension-UI integration timing.

The complete upstream license is included at
`src-tauri/resources/extensions/ubol/LICENSE.txt`.
