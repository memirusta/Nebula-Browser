/**
 * Opening a document from disk (a .html file, a PDF, a picture) in a tab. Only a person can ask for this: by
 * typing or pasting its path or file address into the address bar, or by opening the file with Nebula from
 * Windows. A web page can never send a tab to a local file (see `windowMayOpenLocalFile`): that would let a site
 * open or probe files on the computer.
 *
 * The list of extensions is the same one `src-tauri/src/local_document.rs` checks (a test keeps them equal).
 */
export const OPENABLE_LOCAL_EXTENSIONS = [
  'html', 'htm', 'xhtml', 'xht', 'shtml', 'svg', 'pdf', 'txt', 'json', 'xml',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
  'mp4', 'webm', 'mp3', 'wav', 'ogg', 'm4a',
] as const

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/

function fileNameOf(pathname: string): string {
  const last = pathname.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function hasOpenableExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return false
  const extension = fileName.slice(dot + 1).toLowerCase()
  return (OPENABLE_LOCAL_EXTENSIONS as readonly string[]).includes(extension)
}

/** True for a file address of a document a tab may show (a known kind of file, not a folder or a program). */
export function isOpenableLocalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'file:' && hasOpenableExtension(fileNameOf(url.pathname))
  } catch {
    return false
  }
}

/** The name of the file a file address points to, for the tab title before the page has one. */
export function localDocumentLabel(value: string): string {
  try {
    return fileNameOf(new URL(value).pathname) || value
  } catch {
    return value
  }
}

function encodeSegments(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/**
 * The file address for what was typed or pasted: a file address (file:///C:/a/b.html), a Windows path
 * (C:\a\b.html, also with forward slashes and with the quotes Explorer's "Copy as path" adds) or a network path
 * (\\server\share\b.html). Null when it is none of these, or points to something a tab will not open.
 */
export function localFileUrlFromInput(input: string): string | null {
  const text = input.trim().replace(/^"(.*)"$/, '$1').trim()
  if (!text) return null

  if (/^file:/i.test(text)) {
    try {
      const url = new URL(text)
      return isOpenableLocalUrl(url.href) ? url.href : null
    } catch {
      return null
    }
  }

  let url: string
  if (DRIVE_PATH.test(text)) {
    const drive = text.slice(0, 2)
    url = 'file:///' + drive + encodeSegments(text.slice(2).replace(/\\/g, '/'))
  } else if (UNC_PATH.test(text)) {
    const parts = text.slice(2).replace(/\\/g, '/').split('/')
    url = 'file://' + parts[0] + encodeSegments('/' + parts.slice(1).join('/'))
  } else {
    return null
  }
  return isOpenableLocalUrl(url) ? url : null
}

/**
 * May the page of `openerUrl` send a new tab or window to `targetUrl`? Never to a local file, unless the page
 * is itself a local file (a local page linking to its sibling pages, as in every browser).
 */
export function windowMayOpenLocalFile(targetUrl: string, openerUrl: string | null | undefined): boolean {
  let protocol: string
  try {
    protocol = new URL(targetUrl).protocol
  } catch {
    return true
  }
  if (protocol !== 'file:') return true
  return Boolean(openerUrl) && /^file:/i.test(openerUrl as string) && isOpenableLocalUrl(targetUrl)
}
