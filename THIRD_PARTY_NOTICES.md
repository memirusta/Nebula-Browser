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

## Crab Nebula image (first-run screens)

The first-run screens show a photograph of the Crab Nebula, resized to 2400 px
(`src/assets/onboarding/crab-nebula.jpg`).

- Credit: NASA, ESA, G. Dubner (IAFE, CONICET-University of Buenos Aires) et
  al.; A. Loll et al.; T. Temim et al.; F. Seward et al.; VLA/NRAO/AUI/NSF;
  Chandra/CXC; Spitzer/JPL-Caltech; XMM-Newton/ESA; and Hubble/STScI
- Source: Space Telescope Science Institute (STScI), Hubble site
- Terms: NASA content is not copyrighted and may be used with credit; this use
  does not imply endorsement by NASA, ESA or STScI. The ESA and third-party
  contributions to the image have not been separately cleared yet.

## Plus Jakarta Sans (first-run screens)

The first-run screens use the Plus Jakarta Sans variable font, bundled as the
Latin and Latin Extended subsets (`src/assets/fonts/`).

- Project: https://github.com/tokotype/PlusJakartaSans
- Packaged by: Fontsource (`@fontsource-variable/plus-jakarta-sans` 5.2.8)
- License: SIL Open Font License 1.1, copied at
  `src/assets/fonts/PlusJakartaSans-OFL.txt`
