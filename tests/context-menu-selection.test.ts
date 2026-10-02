import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadModule(path: string, imports: Record<string, unknown> = {}): Record<string, unknown> {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    document: { body: {} },
    require: (id: string) => {
      if (id in imports) return imports[id]
      if (id === 'react' || id === 'react/jsx-runtime') return require(id)
      throw new Error(`Unexpected test import: ${id}`)
    },
  })
  return exports
}

const platform = loadModule('../src/platform/tauriContextMenu.ts', {
  '@tauri-apps/api/core': {}, '@tauri-apps/api/event': {}, './runtime': { isTauri: false },
})
const base = loadModule('../src/core/localeMessages.ts').LOCALE_MESSAGES as Record<string, { tr: string; en: string }>
const additional = loadModule('../src/core/localeMessages.additional.ts')
const itJa = loadModule('../src/core/localeMessages.it-ja.ts')
const translations = [
  base.ctxOpenNewTab.tr, base.ctxOpenNewTab.en,
  (loadModule('../src/core/localeMessages.de.ts').DE_LOCALE_MESSAGES as Record<string, string>).ctxOpenNewTab,
  (loadModule('../src/core/localeMessages.es.ts').ES_LOCALE_MESSAGES as Record<string, string>).ctxOpenNewTab,
  ...['FR_LOCALE_MESSAGES', 'ID_LOCALE_MESSAGES', 'RU_LOCALE_MESSAGES'].map(name =>
    (additional[name] as Record<string, string>).ctxOpenNewTab),
  ...['IT_LOCALE_MESSAGES', 'JA_LOCALE_MESSAGES'].map(name =>
    (itJa[name] as Record<string, string>).ctxOpenNewTab),
]

function renderMenu(label: string, withSelection: boolean, withNativeInspect = false, withPasswords = false): string {
  const { SiteContextMenu } = loadModule('../src/components/SiteContextMenu/SiteContextMenu.tsx', {
    '../../platform/tauriContextMenu': platform,
    '../../hooks/useLocale': { useLocale: () => ({ t: (key: string) => ['ctxOpenNewTab', 'gsImportPasswords'].includes(key) ? label : key }) },
    './SiteContextMenu.module.css': {},
    'react-dom': { createPortal: (children: unknown) => children },
  })
  const command = (commandId: unknown, name: string) => ({
    commandId, name, label: '', shortcut: '', kind: 'command', enabled: true,
    checked: false, children: [],
  })
  return renderToStaticMarkup(createElement(SiteContextMenu as ComponentType<Record<string, unknown>>, {
    request: {
      id: 'selection-fixture', tabLabel: 'nebula-tab-fixture', x: 0, y: 0,
      pageUri: 'https://example.com/', frameUri: '', linkUri: '', sourceUri: '',
      selectionText: withSelection ? 'example.org' : 'ordinary text', editable: false,
      items: [
        ...(withSelection ? [command(platform.NEBULA_OPEN_SELECTION_COMMAND_ID, 'nebula-open-selected-address')] : []),
        ...(withNativeInspect ? [command(platform.NEBULA_INSPECT_COMMAND_ID, 'inspect')] : []),
        ...(withPasswords ? [{ ...command(50_000, 'submenu'), kind: 'submenu', children: [
          { ...command(platform.NEBULA_PASSWORD_SETTINGS_COMMAND_ID, 'nebula-import-passwords'), label: 'Edge import' },
        ] }] : []),
      ],
    },
    onSelect: () => {},
  }))
}

test('selected-address action renders the current label in all nine app languages', () => {
  assert.equal(translations.length, 9)
  for (const label of translations) {
    assert.equal(typeof label, 'string')
    assert.ok(label.length > 0)
    for (const nativeInspect of [false, true]) {
      const html = renderMenu(label, true, nativeInspect)
      assert.ok(html.includes(`>${label}</span>`), `${label} was not rendered`)
      assert.ok(!html.includes('nebula-open-selected-address'))
    }
  }
})

test('ordinary selected text does not gain an open-address command', () => {
  assert.ok(!renderMenu(base.ctxOpenNewTab.tr, false).includes(base.ctxOpenNewTab.tr))
})

test('password import replaces native text in nested menus in all nine languages', () => {
  const labels = [base.gsImportPasswords.tr, base.gsImportPasswords.en,
    ...['de', 'es'].map(locale => (loadModule(`../src/core/localeMessages.${locale}.ts`)[`${locale.toUpperCase()}_LOCALE_MESSAGES`] as Record<string, string>).gsImportPasswords),
    ...['FR', 'ID', 'RU'].map(locale => (additional[`${locale}_LOCALE_MESSAGES`] as Record<string, string>).gsImportPasswords),
    ...['IT', 'JA'].map(locale => (itJa[`${locale}_LOCALE_MESSAGES`] as Record<string, string>).gsImportPasswords),
  ]
  for (const label of labels) {
    assert.ok(label)
    const html = renderMenu(label, false, true, true)
    assert.ok(html.includes(`>${label}</span>`), label)
    assert.ok(!html.includes('Edge import'))
  }
})
