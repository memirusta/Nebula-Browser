import { invoke } from '@tauri-apps/api/core'
import { emitChromeAction } from '../core/nebulaBridge'

export async function flushPendingExternalUrls(): Promise<void> {
  const urls = await invoke<string[]>('take_pending_open_urls')

  for (const url of urls) {
    await emitChromeAction({
      type: 'open-tab',
      shortcutId: '',
      url,
    })
  }
}