// `npm run tauri ...` goes through here.
//
// `tauri dev` runs with its own app identity (src-tauri/tauri.dev.conf.json), so it keeps its data in its own
// folders (%LOCALAPPDATA%\com.nebula.browser.dev) instead of the installed Nebula's. Without this, a factory reset
// in the dev build erased the installed browser's settings, sign-ins and extensions too: both used the
// com.nebula.browser profile. Every other command is passed to the Tauri CLI unchanged.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEV_CONFIG = 'src-tauri/tauri.dev.conf.json'

/** The arguments to give the Tauri CLI. Only a plain `dev` gets the dev identity; an explicit --config wins. */
export function withDevIdentity(args) {
  if (args[0] !== 'dev') return args

  // Anything after `--` belongs to cargo or the app, not to the CLI.
  const separator = args.indexOf('--')
  const cli = separator === -1 ? args : args.slice(0, separator)
  const rest = separator === -1 ? [] : args.slice(separator)

  if (cli.some((arg) => arg === '--config' || arg === '-c' || arg.startsWith('--config='))) return args

  return [...cli, '--config', DEV_CONFIG, ...rest]
}

function run() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
  const args = withDevIdentity(process.argv.slice(2))

  const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' })

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exit(code ?? 1)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run()
