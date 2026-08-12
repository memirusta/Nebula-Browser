function asError(error, fallback) {
  return error instanceof Error ? error : new Error(String(error || fallback))
}

export class Cdp {
  constructor(
    wsUrl,
    { callTimeoutMs = 20_000, WebSocketImpl = globalThis.WebSocket } = {},
  ) {
    this.ws = new WebSocketImpl(wsUrl)
    this.callTimeoutMs = callTimeoutMs
    this.nextId = 1
    this.pending = new Map()
    this.opened = false
    this.terminalError = null

    this.ws.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }

      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return

      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new Error(message.error.message || JSON.stringify(message.error)),
        )
      } else {
        pending.resolve(message.result)
      }
    })
    this.ws.addEventListener('close', () => {
      this.abort(new Error('CDP connection closed.'))
    })
    this.ws.addEventListener('error', (event) => {
      this.abort(asError(event?.error, 'CDP connection failed.'))
    })
  }

  async open() {
    if (this.terminalError) throw this.terminalError
    if (this.ws.readyState === 1) {
      this.opened = true
      return
    }

    await new Promise((resolvePromise, reject) => {
      const onOpen = () => {
        cleanup()
        this.opened = true
        resolvePromise()
      }
      const onFailure = () => {
        cleanup()
        reject(this.terminalError || new Error('CDP connection failed to open.'))
      }
      const cleanup = () => {
        this.ws.removeEventListener('open', onOpen)
        this.ws.removeEventListener('error', onFailure)
        this.ws.removeEventListener('close', onFailure)
      }

      this.ws.addEventListener('open', onOpen, { once: true })
      this.ws.addEventListener('error', onFailure, { once: true })
      this.ws.addEventListener('close', onFailure, { once: true })
    })
  }

  call(method, params = {}) {
    if (this.terminalError) return Promise.reject(this.terminalError)
    if (!this.opened || this.ws.readyState !== 1) {
      return Promise.reject(new Error(`CDP is not open; cannot call ${method}.`))
    }

    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP call timed out: ${method}`))
      }, this.callTimeoutMs)

      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(asError(error, `CDP send failed: ${method}`))
      }
    })
  }

  async eval(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          'Runtime.evaluate failed',
      )
    }
    return result.result?.value
  }

  abort(error) {
    if (this.terminalError) return
    this.terminalError = asError(error, 'CDP aborted.')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(this.terminalError)
    }
    this.pending.clear()
  }

  close() {
    this.abort(new Error('CDP connection closed by the smoke runner.'))
    try {
      this.ws.close()
    } catch {
      // noop
    }
  }
}

export async function pollUntil(label, fn, deadline, getFatalError = () => null) {
  let value
  while (Date.now() < deadline) {
    const fatalError = getFatalError()
    if (fatalError) throw fatalError

    const remainingMs = Math.max(1, deadline - Date.now())
    value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout: ${label}`))
        }, remainingMs)
      }),
    ])

    const failureAfterCall = getFatalError()
    if (failureAfterCall) throw failureAfterCall
    if (value) return value
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timeout: ${label}`)
}
