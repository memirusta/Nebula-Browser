import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function fixture() {
  const storage = new Map<string, string>()
  const imports: ReturnType<typeof deferred<string>>[] = []
  const removed: string[] = []
  const inputs: { files: object[]; onchange?: () => Promise<void>; click: () => void }[] = []
  const cleanups: (() => void)[] = []
  const decoded = deferred<object>()
  let failConfigSave = false
  let lockTail: Promise<unknown> = Promise.resolve()
  const globals = {
    crypto,
    window: new EventTarget(),
    navigator: { locks: { request: (_name: string, operation: () => unknown) => {
      const pending = lockTail.catch(() => undefined).then(operation)
      lockTail = pending
      return pending
    } } },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failConfigSave && key === 'nebula-wallpaper-config-v2') throw new Error('quota')
        storage.set(key, value)
      },
      removeItem: (key: string) => storage.delete(key),
    },
    createImageBitmap: () => decoded.promise,
    document: { createElement: (tag: string) => {
      if (tag === 'canvas') return {
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,synthetic',
      }
      const input = { files: [{}], click() {} }
      inputs.push(input)
      return input
    } },
  }
  function load(path: string, dependencies: Record<string, unknown>) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const exports: Record<string, unknown> = {}
    vm.runInNewContext(output, { ...globals, exports, module: { exports }, require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    } })
    return exports
  }
  const wallpaperStorage = load('../src/core/wallpaperStorage.ts', {
    './constants': { WALLPAPER_STORAGE_KEY: 'nebula-wallpaper' },
  })
  const config = load('../src/core/wallpaperConfig.ts', {
    './wallpaperStorage': wallpaperStorage,
  }) as typeof import('../src/core/wallpaperConfig.ts')
  function newWindow() {
    // Separate module instances share only origin storage and the browser lock.
    const media = load('../src/platform/wallpaperMedia.ts', {
      '@tauri-apps/api/core': { invoke: (command: string, args: { paths: string[] }) => {
        if (command === 'wallpaper_import_video') {
          const pending = deferred<string>()
          imports.push(pending)
          return pending.promise
        }
        assert.equal(command, 'wallpaper_clear_videos')
        removed.push(...args.paths)
        return Promise.resolve()
      } },
      '@tauri-apps/plugin-dialog': { open: async () => 'synthetic-source.mp4' },
      './runtime': { isTauri: true },
    })
    const hook = load('../src/hooks/useWallpaper.ts', {
      react: {
        useState: (initial: () => unknown) => [initial(), () => {}],
        useRef: (current: unknown) => ({ current }),
        useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => () => void) => cleanups.push(effect()),
      },
      '../core/wallpaperStorage': wallpaperStorage,
      '../core/wallpaperConfig': config,
      '../platform/wallpaperMedia': media,
      '../core/appDialog': { showAppAlert: async () => {} },
      '../core/locale': { loadLocale: () => 'en' },
    }) as typeof import('../src/hooks/useWallpaper.ts')
    return hook.useWallpaper()
  }
  config.persistWallpaperConfig({ ...config.DEFAULT_WALLPAPER_CONFIG, mode: 'video', videoPath: 'old.mp4' })
  return { newWindow, config, imports, removed, storage, inputs, decoded, cleanups,
    failSave: () => { failConfigSave = true } }
}

test('reset wins over a video import that finishes later', async () => {
  const f = fixture()
  const wallpaper = f.newWindow()
  const importing = wallpaper.pickVideoWallpaper()
  await tick()
  assert.equal(f.imports.length, 1)
  await wallpaper.resetWallpaper()
  f.imports[0].resolve('late.mp4')
  await importing
  assert.equal(f.config.loadWallpaperConfig().videoPath, null)
  assert.deepEqual(f.removed.sort(), ['late.mp4', 'old.mp4'])
})

test('the newest choice in another window survives out-of-order imports', async () => {
  const f = fixture()
  const first = f.newWindow().pickVideoWallpaper()
  await tick()
  const second = f.newWindow().pickVideoWallpaper()
  await tick()
  f.imports[1].resolve('newest.mp4')
  await second
  f.imports[0].resolve('stale.mp4')
  await first
  assert.equal(f.config.loadWallpaperConfig().videoPath, 'newest.mp4')
  assert.deepEqual(f.removed.sort(), ['old.mp4', 'stale.mp4'])
})

test('a failed config save keeps the existing video and cleans only the new import', async () => {
  const f = fixture()
  const importing = f.newWindow().pickVideoWallpaper()
  await tick()
  f.failSave()
  f.imports[0].resolve('unsaved.mp4')
  await importing
  assert.equal(f.config.loadWallpaperConfig().videoPath, 'old.mp4')
  assert.deepEqual(f.removed, ['unsaved.mp4'])
})

test('reset during image decoding prevents legacy image storage from reappearing', async () => {
  const f = fixture()
  const wallpaper = f.newWindow()
  wallpaper.pickWallpaper()
  const selecting = f.inputs[0].onchange!()
  await tick()
  const resetting = wallpaper.resetWallpaper()
  let closed = false
  f.decoded.resolve({ width: 10, height: 10, close: () => { closed = true } })
  await Promise.all([selecting, resetting])
  assert.equal(f.storage.has('nebula-wallpaper'), false)
  assert.equal(f.config.loadWallpaperConfig().imageUrl, null)
  assert.equal(closed, true)
})

test('an import finishing after the window unmounts is discarded', async () => {
  const f = fixture()
  const importing = f.newWindow().pickVideoWallpaper()
  await tick()
  f.cleanups[0]()
  f.imports[0].resolve('orphan.mp4')
  await importing
  assert.equal(f.config.loadWallpaperConfig().videoPath, 'old.mp4')
  assert.deepEqual(f.removed, ['orphan.mp4'])
})

test('failed reset storage keeps the selected video available', async () => {
  const f = fixture()
  const wallpaper = f.newWindow()
  f.failSave()
  await wallpaper.resetWallpaper()
  assert.equal(f.config.loadWallpaperConfig().videoPath, 'old.mp4')
  assert.deepEqual(f.removed, [])
})
