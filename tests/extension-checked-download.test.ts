import assert from 'node:assert/strict'
import test from 'node:test'
import { checkedExtensionDownload } from '../src/core/extensionCheckedDownload.ts'
import { extensionDownloadCheckCopy } from '../src/core/extensionDownloadCheckCopy.ts'

const completed = {
  path: 'C:/Downloads/extension.zip', version: '1.0', bytes: 200,
  compatibility: {runtimeVersion:'152.0.4191.66', manifest:{manifest_version:3, version:'1.0'}, loadTest:'passed', functionalityTest:'not-run', source:'chrome-web-store-crx', sourceId:'efaidnbmnnnibpcajpcglclefindmkaj', sha256:'a'.repeat(64)},
}
test('legacy download responses and incomplete probes cannot claim compatibility', () => {
  for (const result of [null, {}, {...completed, compatibility:undefined},
    {...completed, compatibility:{...completed.compatibility, loadTest:'pending'}},
    {...completed, compatibility:{...completed.compatibility, runtimeVersion:''}},
    {...completed, compatibility:{...completed.compatibility, source:'unknown'}},
    {...completed, compatibility:{...completed.compatibility, sourceId:''}},
    {...completed, compatibility:{...completed.compatibility, sha256:'not-a-hash'}},
    {...completed, compatibility:{...completed.compatibility, manifest:{version:'2.0'}}}]) {
    assert.throws(() => checkedExtensionDownload(result))
  }
})
test('a completed load probe still explicitly leaves functionality untested', () => {
  assert.equal(checkedExtensionDownload(completed).compatibility.functionalityTest, 'not-run')
})
test('download compatibility progress and limits are localized', () => {
  for (const locale of ['tr','en','de','es','fr','id','ru','it','ja'] as const) {
    const copy = extensionDownloadCheckCopy(locale)
    assert.ok(copy.pending && copy.passed && copy.failed && copy.scope)
  }
})
