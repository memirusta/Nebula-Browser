# Third-party notices

## Nebula Shield: filter lists and scriptlets

Nebula's own blocker (the shield, `src-tauri/src/shield.rs`) is built from third-party work that ships inside the app. Nothing
is downloaded at run time.

- **Engine:** `adblock` (adblock-rust) by Brave Software, MPL-2.0. https://github.com/brave/adblock-rust
  - `cssparser`, `selectors`, `cssparser-macros` and `dtoa-short` (the Servo project), MPL-2.0, and `phf*` and `precomputed-hash`, MIT: what the engine reads hiding rules with.
- **Filter lists** (`src-tauri/resources/shield/lists/`):
  - EasyList and EasyPrivacy, https://easylist.to/. Dual licensed under GPL-3.0-or-later and CC BY-SA 3.0 (https://easylist.to/pages/licence.html).
  - uBlock filters, Privacy, Unbreak and Badware (uBlockOrigin/uAssets), https://github.com/uBlockOrigin/uAssets. Licensed as set out in
    https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE.
  - Peter Lowe's ad server list, https://pgl.yoyo.org/adservers/. Offered for anyone to use and redistribute.
- **Scriptlets and stand-in resources** (`src-tauri/resources/shield/ubo-scriptlets.json`): the scriptlets and web-accessible
  resources of uBlock Origin by Raymond Hill, https://github.com/gorhill/uBlock, GPL-3.0. The file is generated from that
  source by `scripts/build-shield-resources.mjs`; run it again when the lists are updated.

Earlier versions of Nebula bundled uBlock Origin Lite (also GPL-3.0, https://github.com/uBlockOrigin/uBOL-home) as a browser
extension. It is no longer part of the app, and the copy those versions installed is removed from the profile at start.

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
