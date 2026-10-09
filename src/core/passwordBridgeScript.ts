/** Injected into site tab webviews for credential field detection and filling. */

import { PASSWORD_FIELD_DETECTION_SOURCE } from './passwordFieldDetection.ts'

export const PASSWORD_HOOK_VERSION = 10
export const PASSWORD_BRIDGE_NEEDS_BOOTSTRAP = '__nebula_password_bridge_needs_bootstrap__'

export type PasswordFillTarget = 'username' | 'password' | 'both'

export interface PasswordBridgePollResult {
  pending?: {
    type: string
    username: string
    password: string
    url: string
    t: number
  } | null
  hasForm?: boolean
  hasPasswordField?: boolean
  /** Any visible password field, including new-password ones (a sign-up or password-change form). */
  hasAnyPasswordField?: boolean
  hasUsernameField?: boolean
  /** Changes with every page load: a reload of the same address is a new document. */
  docId?: string
  href?: string
  error?: string
}

export function buildPasswordBridgeTickScript(): string {
  return `
(function() {
  var HOOK_V = ${PASSWORD_HOOK_VERSION};
  var pendingCreds = null;
  var DOC_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

${PASSWORD_FIELD_DETECTION_SOURCE}

  function hasCredentialAction() {
    var controls = document.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (var i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!isVisible(control)) continue;
      var text = [
        control.textContent,
        control.value,
        control.getAttribute('aria-label'),
        control.getAttribute('title'),
        control.getAttribute('name'),
        control.getAttribute('id')
      ].filter(Boolean).join(' ').toLowerCase();
      if (/(next|continue|sign[ -]?in|log[ -]?in|submit|verify|ileri|devam|giriş|giris|oturum)/.test(text)) return true;
    }
    var path = String(location.pathname || '').toLowerCase();
    return /(login|signin|sign-in|oauth|authorize|auth)/.test(path);
  }

  function findLoginFields() {
    var password = findPasswordInput();
    if (!password) return null;
    var username = findUsernameFor(password);
    if (!username) return null;
    return { username: username, password: password };
  }

  function capturePending(reason, event) {
    if (event && event.isTrusted === false) return;
    var password = findPasswordToSave();
    if (!password) return;
    var pass = String(password.value || '');
    if (!pass) return;
    var usernameField = findUsernameFor(password);
    var user = usernameField ? String(usernameField.value || '').trim() : '';
    // A password change has no account field of its own; the shell then uses the one saved account of the site.
    if (!user && !isPasswordChangeForm()) return;
    pendingCreds = {
      type: reason,
      username: user,
      password: pass,
      url: location.href,
      t: Date.now()
    };
  }

  document.addEventListener('submit', function(event) {
    capturePending('submit', event);
  }, true);

  document.addEventListener('click', function(event) {
    if (!event.isTrusted) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var button = target.closest('button, input[type="submit"], [role="button"]');
    if (!button) return;
    capturePending('click', event);
  }, true);

  document.addEventListener('keydown', function(event) {
    if (!event.isTrusted || event.key !== 'Enter') return;
    capturePending('enter', event);
  }, true);

  window.__nebulaPasswordBridgeTick = function() {
    try {
      var pending = pendingCreds;
      pendingCreds = null;
      var hasPasswordField = !!findPasswordInput();
      // A sign-up or password-change page (only new-password fields) is not a login: no saved account is offered.
      var hasAnyPasswordField = visiblePasswordInputs().length > 0;
      var onlyNewPasswords = hasAnyPasswordField && !hasPasswordField;
      var hasUsernameField = !!findUsernameInput() && (hasPasswordField || (hasCredentialAction() && !onlyNewPasswords));
      var hasForm = !!findLoginFields();
      var href = location.href || '';
      if (href.indexOf('http') !== 0) {
        return JSON.stringify({
          pending: null,
          hasForm: false,
          hasPasswordField: false,
          hasUsernameField: false,
          href: href
        });
      }
      return JSON.stringify({
        pending: pending,
        hasForm: hasForm,
        hasPasswordField: hasPasswordField,
        hasAnyPasswordField: hasAnyPasswordField,
        hasUsernameField: hasUsernameField,
        docId: DOC_ID,
        href: href
      });
    } catch (error) {
      return JSON.stringify({
        error: String(error),
        href: location.href || '',
        hasForm: false,
        hasPasswordField: false,
        hasUsernameField: false
      });
    }
  };

  window.__nebulaPwdHookV = HOOK_V;
  return window.__nebulaPasswordBridgeTick();
})()
`.trim()
}

export function buildPasswordBridgePollScript(): string {
  return `
(function() {
  if (
    window.__nebulaPwdHookV !== ${PASSWORD_HOOK_VERSION} ||
    typeof window.__nebulaPasswordBridgeTick !== 'function'
  ) {
    return ${JSON.stringify(PASSWORD_BRIDGE_NEEDS_BOOTSTRAP)};
  }
  return window.__nebulaPasswordBridgeTick();
})()
`.trim()
}

export function buildPasswordFillScript(
  username: string,
  password: string,
  target: PasswordFillTarget = 'both',
): string {
  // Do not put an unused secret into the page's execution script. On split
  // login step 1 the password is intentionally absent from the injected source.
  const userJson = target === 'password' ? 'null' : JSON.stringify(username)
  const passwordJson = target === 'username' ? 'null' : JSON.stringify(password)
  const targetJson = JSON.stringify(target)

  return `
(function() {
  var fillTarget = ${targetJson};
  var userValue = ${userJson};
  var passValue = ${passwordJson};

  function setFrameworkFriendlyValue(element, value) {
    if (!element || value === null) return;
    try {
      var proto = element.constructor && element.constructor.prototype;
      var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) descriptor.set.call(element, value);
      else element.value = value;

      var tracker = element._valueTracker;
      if (tracker) tracker.setValue('');

      if (typeof InputEvent === 'function') {
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertFromPaste',
          data: value
        }));
      } else {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

${PASSWORD_FIELD_DETECTION_SOURCE}

  try {
    if (fillTarget === 'username') {
      var usernameOnly = findUsernameInput();
      if (!usernameOnly) return false;
      usernameOnly.focus();
      setFrameworkFriendlyValue(usernameOnly, userValue);
      return 'username';
    }

    if (fillTarget === 'password') {
      var passwordOnly = findPasswordInput();
      if (!passwordOnly) return false;
      setFrameworkFriendlyValue(passwordOnly, passValue);
      passwordOnly.focus();
      return 'password';
    }

    var passwordEl = findPasswordInput();
    // A sign-up or password-change page (only new-password fields) is not a login: nothing is filled.
    if (!passwordEl && visiblePasswordInputs().length > 0) return false;
    var usernameEl = passwordEl ? findUsernameFor(passwordEl) : findUsernameInput();
    if (!usernameEl && !passwordEl) return false;

    if (usernameEl) {
      usernameEl.focus();
      setFrameworkFriendlyValue(usernameEl, userValue);
    }
    if (passwordEl) {
      setFrameworkFriendlyValue(passwordEl, passValue);
      passwordEl.focus();
    }

    if (usernameEl && passwordEl) return 'both';
    if (usernameEl) return 'username';
    return 'password';
  } catch (_) {
    return false;
  }
})()
`.trim()
}

export function parsePasswordBridgePoll(raw: string): PasswordBridgePollResult | null {
  if (!raw?.trim()) return null
  try {
    const unwrapped = JSON.parse(raw) as unknown
    return typeof unwrapped === 'string'
      ? (JSON.parse(unwrapped) as PasswordBridgePollResult)
      : (unwrapped as PasswordBridgePollResult)
  } catch {
    return null
  }
}
