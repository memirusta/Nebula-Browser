import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  MAX_SYNCED_IMAGE_CHARS,
  WALLPAPER_SYNC_KEY,
  wallpaperForBackup,
  wallpaperToRestore,
} from '../src/core/wallpaperSync.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const config = (patch: Record<string, unknown>) => JSON.stringify({
  version: 2, mode: 'ambient', fit: 'cover', position: { x: 50, y: 50 }, imageUrl: null, videoPath: null,
  ambientPreset: 'aurora', ambientIntensity: 0.6, ambientSpeed: 1.5, ...patch,
})

test('the sync key is the key the wallpaper settings are stored under', () => {
  assert.match(read('src/core/wallpaperConfig.ts'), new RegExp(`WALLPAPER_CONFIG_KEY =\\s+'${WALLPAPER_SYNC_KEY}'`))
})

test('the default background of a video device is the one every new person starts with', () => {
  const source = read('src/core/wallpaperConfig.ts')
  const defaults = source.slice(source.indexOf('export const DEFAULT_WALLPAPER_CONFIG'), source.indexOf('function clamp'))
  const sync = read('src/core/wallpaperSync.ts')
  const stand = sync.slice(sync.indexOf('const DEFAULT_BACKGROUND'), sync.indexOf('} as const'))
  for (const [key, value] of [['mode', "'ambient'"], ['fit', "'cover'"], ['ambientPreset', "'nebula'"], ['ambientIntensity', '0.72'], ['ambientSpeed', '1']]) {
    assert.match(defaults, new RegExp(`${key}: ${value}`), `default ${key}`)
    assert.match(stand, new RegExp(`${key}: ${value}`), `stand-in ${key}`)
  }
})

test('a moving background goes into the backup as it is', () => {
  const backup = JSON.parse(wallpaperForBackup(config({}))!)
  assert.equal(backup.mode, 'ambient')
  assert.equal(backup.ambientPreset, 'aurora')
  assert.equal(backup.ambientIntensity, 0.6)
  assert.equal(backup.ambientSpeed, 1.5)
  assert.equal(backup.syncedFromVideo, undefined)
})

test('a picture goes into the backup, and one too big for the backup stays on the device', () => {
  const small = JSON.parse(wallpaperForBackup(config({ mode: 'image', imageUrl: 'data:image/jpeg;base64,AAAA' }))!)
  assert.equal(small.mode, 'image')
  assert.equal(small.imageUrl, 'data:image/jpeg;base64,AAAA')

  const big = JSON.parse(wallpaperForBackup(config({ mode: 'image', imageUrl: 'x'.repeat(MAX_SYNCED_IMAGE_CHARS + 1) }))!)
  assert.equal(big.imageUrl, null)
  assert.equal(big.mode, 'ambient')
})

test('a video never goes into the backup: the default background does, marked as a stand-in', () => {
  // Even with another moving background chosen before the video: the stand-in is the default one.
  const backup = JSON.parse(wallpaperForBackup(config({ mode: 'video', videoPath: 'C:/Users/a/wall.mp4', ambientPreset: 'liquid', ambientIntensity: 0.3, imageUrl: 'data:image/jpeg;base64,AAAA' }))!)
  assert.equal(backup.mode, 'ambient')
  assert.equal(backup.ambientPreset, 'nebula')
  assert.equal(backup.ambientIntensity, 0.72)
  assert.equal(backup.ambientSpeed, 1)
  assert.equal(backup.imageUrl, null)
  assert.equal(backup.videoPath, null)
  assert.equal(backup.syncedFromVideo, true)
  assert.doesNotMatch(JSON.stringify(backup), /wall\.mp4|Users|liquid|AAAA/)

  // A path is never synced, whatever the mode.
  assert.equal(JSON.parse(wallpaperForBackup(config({ videoPath: 'C:/a.mp4' }))!).videoPath, null)
})

test('nothing stored, or something unreadable, puts nothing into the backup', () => {
  assert.equal(wallpaperForBackup(null), null)
  assert.equal(wallpaperForBackup(''), null)
  assert.equal(wallpaperForBackup('not json'), null)
  assert.equal(wallpaperForBackup('[1,2]'), null)
})

test('restoring replaces this device\'s wallpaper, and the marker is not written', () => {
  const restored = JSON.parse(wallpaperToRestore(config({ ambientPreset: 'liquid' }), config({ ambientPreset: 'nebula' }))!)
  assert.equal(restored.ambientPreset, 'liquid')

  const picture = JSON.parse(wallpaperToRestore(config({ mode: 'image', imageUrl: 'data:image/jpeg;base64,AAAA' }), null)!)
  assert.equal(picture.mode, 'image')
  assert.equal(picture.imageUrl, 'data:image/jpeg;base64,AAAA')

  const marked = JSON.parse(wallpaperToRestore(config({ syncedFromVideo: true }), config({ mode: 'image' }))!)
  assert.equal(marked.syncedFromVideo, undefined)
  assert.equal(marked.mode, 'ambient')
})

test('a backup made on a video device does not replace the video of this device', () => {
  const local = config({ mode: 'video', videoPath: 'C:/Users/me/own.mp4' })
  assert.equal(wallpaperToRestore(config({ syncedFromVideo: true }), local), local)
  // Without a video here the stand-in (the default background) is used.
  const standIn = JSON.parse(wallpaperToRestore(wallpaperForBackup(config({ mode: 'video', videoPath: 'C:/a.mp4' }))!, config({ ambientPreset: 'liquid' }))!)
  assert.equal(standIn.mode, 'ambient')
  assert.equal(standIn.ambientPreset, 'nebula')
  assert.equal(standIn.syncedFromVideo, undefined)
  // A backup that was a real choice of the moving background does replace a video.
  assert.equal(JSON.parse(wallpaperToRestore(config({}), local)!).mode, 'ambient')
})

test('a damaged backup entry is not written', () => {
  assert.equal(wallpaperToRestore('not json', config({})), null)
})

test('the wallpaper is its own Sync category, off for preferences saved before it existed', () => {
  const sync = read('src/core/googleSync.ts')
  assert.match(sync, /from '\.\/wallpaperSync'/)
  assert.match(sync, /export interface GoogleSyncPreferences \{[^}]*wallpaper: boolean/)
  // New people get it on; saved preferences that never had it do not start sending a picture unasked.
  assert.match(sync, /DEFAULT_GOOGLE_SYNC_PREFERENCES: GoogleSyncPreferences = \{[^}]*wallpaper: true/)
  assert.match(sync, /wallpaper: parsed\.wallpaper === true/)
  // A backup from before it existed does not turn it on.
  assert.match(sync, /wallpaper: parsed\.categories\.wallpaper === true/)

  // Build only when asked for; restore only when asked for and present; an absent entry removes nothing.
  assert.match(sync, /if \(preferences\.wallpaper\) \{\n\s+const wallpaper = wallpaperForBackup\(localStorage\.getItem\(WALLPAPER_SYNC_KEY\)\)/)
  assert.match(sync, /if \(preferences\.wallpaper && bundle\.categories\.wallpaper\) \{[\s\S]*?if \(typeof wallpaper === 'string'\)/)
  assert.doesNotMatch(sync, /removeLocalStorage\(WALLPAPER_SYNC_KEY\)/)
  assert.match(sync, /wallpaper: local\.categories\.wallpaper \|\| remote\.categories\.wallpaper/)
  // The key is not in the plain settings list, which removes keys a bundle lacks.
  const settingsKeys = sync.slice(sync.indexOf('const SETTINGS_KEYS'), sync.indexOf('] as const'))
  assert.doesNotMatch(settingsKeys, /WALLPAPER/)
})

test('the Sync settings offer the wallpaper as a choice, explained in every language', () => {
  const ui = read('src/components/SettingsPanel/GoogleSyncSettings.tsx')
  assert.match(ui, /checked=\{preferences\.wallpaper\}[\s\S]*?updatePreference\('wallpaper', event\.target\.checked\)/)
  assert.match(ui, /t\('syncWallpaper'\)[\s\S]*?t\('syncWallpaperHint'\)/)
  assert.match(ui, /!preferences\.wallpaper/)

  const locales: Array<[string, number]> = [
    ['src/core/localeMessages.ts', 3],
    ['src/core/localeMessages.additional.ts', 3],
    ['src/core/localeMessages.es.ts', 3],
    ['src/core/localeMessages.de.ts', 3],
    ['src/core/localeMessages.it-ja.ts', 3],
  ]
  for (const [file, expected] of locales) {
    const text = read(file)
    const found = (text.match(/syncWallpaper(?:Hint|VideoNote)?"?:/g) ?? []).length
    assert.equal(found, expected, file)
  }
  // The hint says where a picture goes; the note, shown only on a video, says the video is not backed up.
  assert.match(read('src/core/localeMessages.ts'), /syncWallpaperHint[\s\S]*?Google Drive/)
  assert.match(read('src/core/localeMessages.ts'), /syncWallpaperVideoNote[\s\S]*?not backed up[\s\S]*?Indigo/)
})

test('the note that a video is not backed up shows only while a video wallpaper is chosen', () => {
  const ui = read('src/components/SettingsPanel/GoogleSyncSettings.tsx')
  assert.match(ui, /const wallpaperIsVideo = loadWallpaperConfig\(\)\.mode === 'video'/)
  assert.match(ui, /\{wallpaperIsVideo && <small[^>]*>\{t\('syncWallpaperVideoNote'\)\}<\/small>\}/)
})
