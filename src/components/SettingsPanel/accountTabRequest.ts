/**
 * Something outside the Account page (the password prompts) asks for its Passwords tab. The Account page may not be
 * on screen yet, so the request is kept until it is: a page that is already open hears it as an event, one that is
 * opened for it reads it when it starts.
 */
const EVENT = 'nebula:account-passwords'
let pending = false

export function requestPasswordsTab(): void {
  pending = true
  window.dispatchEvent(new Event(EVENT))
}

export function consumePasswordsTabRequest(): boolean {
  const value = pending
  pending = false
  return value
}

export function onPasswordsTabRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
