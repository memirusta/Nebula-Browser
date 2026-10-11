import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { DownloadItem } from '../src/core/download.ts'

const require = createRequire(import.meta.url)

function loadModule(path: string, imports: Record<string, unknown>): Record<string, unknown> {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {
    exports,
    require: (id: string) => {
      if (id in imports) return imports[id]
      if (id === 'react' || id === 'react/jsx-runtime') return require(id)
      throw new Error(`Unexpected test import: ${id}`)
    },
  })
  return exports
}

const download = loadModule('../src/core/download.ts', {
  '@tauri-apps/api/core': { invoke: () => { throw new Error('Unexpected native invocation') } },
  '@tauri-apps/api/event': {},
  '../platform/runtime': { isTauri: false },
})
const { DownloadManager } = loadModule('../src/components/DownloadManager/DownloadManager.tsx', {
  '../../core/download': download,
  '../../hooks/useLocale': { useLocale: () => ({ t: (key: string) => key, tf: (key: string) => key }) },
  './DownloadManager.module.css': { fileName: 'fileName' },
  '../../styles/floatingPanel.module.css': { viewportBound: 'viewportBound' },
})

function renderDownload(state: DownloadItem['state'], requiresConfirmation: boolean): string {
  const item: DownloadItem = {
    id: 'test-download', tabLabel: 'test-tab', sourceUrl: 'https://example.com/setup.exe',
    fileName: 'setup.exe', filePath: 'C:\\test\\setup.exe', mimeType: 'application/octet-stream',
    totalBytes: 10, receivedBytes: 10, state, interruptReason: 0, canResume: false,
    paused: false, dangerReason: requiresConfirmation ? 'dangerous_file_type' : null,
    requiresConfirmation, startedAtMs: 1,
  }
  return renderToStaticMarkup(createElement(DownloadManager as ComponentType<Record<string, unknown>>, {
    items: [item], variant: 'home', onAction: async () => {}, onRemove: () => {},
    onClearFinished: () => {}, onClose: () => {},
  }))
}

test('review-required completed downloads cannot be opened or dragged before Keep', () => {
  const html = renderDownload('completed', true)
  assert.match(html, /class="fileName"[^>]*disabled=""[^>]*draggable="false"/)
  assert.doesNotMatch(html, /draggable="true"/)
  assert.match(html, /downloadNeedsReview/)
  assert.match(html, /downloadKeep/)
  assert.match(html, /downloadDelete/)
  assert.doesNotMatch(html, /downloadClearFinished/)
  assert.doesNotMatch(html, /downloadRemove/)
})

test('a cleared completed download regains opening and both drag handles', () => {
  const html = renderDownload('completed', false)
  assert.match(html, /class="fileName"[^>]*draggable="true"/)
  assert.doesNotMatch(html, /disabled=""/)
  assert.equal(html.match(/draggable="true"/g)?.length, 2)
  assert.doesNotMatch(html, /downloadNeedsReview|downloadKeep/)
})

test('unfinished or interrupted downloads cannot be opened or dragged', () => {
  for (const state of ['in_progress', 'paused', 'interrupted', 'cancelled'] as const) {
    const html = renderDownload(state, false)
    assert.match(html, /class="fileName"[^>]*disabled=""[^>]*draggable="false"/)
    assert.doesNotMatch(html, /draggable="true"/)
  }
})
