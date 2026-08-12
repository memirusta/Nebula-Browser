/** Injected into site tab webviews for credential field detection and filling. */

export const PASSWORD_HOOK_VERSION = 8
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
  hasUsernameField?: boolean
  href?: string
  error?: string
}

export function buildPasswordBridgeTickScript(): string {
  return `
(function() {
  var HOOK_V = ${PASSWORD_HOOK_VERSION};
  var pendingCreds = null;

  function isVisible(el) {
    try {
      if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
      if ((el.type || '').toLowerCase() === 'hidden') return false;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function isPasswordInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var type = (el.type || '').toLowerCase();
    if (type === 'password') return true;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return ac === 'current-password' || ac === 'new-password';
  }

  function usernameScore(el) {
    if (!el || el.tagName !== 'INPUT' || !isVisible(el) || isPasswordInput(el)) return -1;
    var type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') return -1;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    var name = (el.getAttribute('name') || '').toLowerCase();
    var id = (el.getAttribute('id') || '').toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var haystack = name + ' ' + id + ' ' + aria;
    if (ac === 'username') return 100;
    if (ac === 'email') return 98;
    if (type === 'email') return 95;
    if (name === 'loginfmt' || id === 'loginfmt') return 94;
    if (haystack.indexOf('email') >= 0) return 90;
    if (haystack.indexOf('username') >= 0 || haystack.indexOf('user-name') >= 0) return 88;
    if (haystack.indexOf('login') >= 0 || haystack.indexOf('signin') >= 0 || haystack.indexOf('sign-in') >= 0) return 84;
    if (type === 'tel' && (haystack.indexOf('phone') >= 0 || haystack.indexOf('mobile') >= 0)) return 80;
    return -1;
  }

  function findUsernameInput(scope) {
    var inputs = scope || document.querySelectorAll('input');
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < inputs.length; i++) {
      var score = usernameScore(inputs[i]);
      if (score > bestScore) {
        best = inputs[i];
        bestScore = score;
      }
    }
    return bestScore >= 80 ? best : null;
  }

  function findPasswordInput() {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (isPasswordInput(inputs[i]) && isVisible(inputs[i])) return inputs[i];
    }
    return null;
  }

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

    var form = password.closest && password.closest('form');
    var scope = form ? form.querySelectorAll('input') : document.querySelectorAll('input');
    var username = findUsernameInput(scope);

    // Conservative fallback for old/basic forms with no useful autocomplete,
    // name or id metadata: accept only one visible text-like field before the
    // password, rather than grabbing an arbitrary text input.
    if (!username && form) {
      var candidates = [];
      for (var i = 0; i < scope.length; i++) {
        var input = scope[i];
        if (!input || input === password || !isVisible(input) || isPasswordInput(input)) continue;
        var type = (input.type || '').toLowerCase();
        if (type !== 'text' && type !== 'email' && type !== 'tel') continue;
        if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) {
          candidates.push(input);
        }
      }
      if (candidates.length === 1) username = candidates[0];
    }

    if (!username) return null;
    return { username: username, password: password };
  }

  function capturePending(reason, event) {
    if (event && event.isTrusted === false) return;
    var fields = findLoginFields();
    if (!fields) return;
    var user = String(fields.username.value || '').trim();
    var pass = String(fields.password.value || '');
    if (!user || !pass) return;
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
      var hasUsernameField = !!findUsernameInput() && (hasPasswordField || hasCredentialAction());
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
        hasUsernameField: hasUsernameField,
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

  function isVisible(el) {
    try {
      if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
      if ((el.type || '').toLowerCase() === 'hidden') return false;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function isPasswordInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var type = (el.type || '').toLowerCase();
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return type === 'password' || ac === 'current-password' || ac === 'new-password';
  }

  function usernameScore(el) {
    if (!el || el.tagName !== 'INPUT' || !isVisible(el) || isPasswordInput(el)) return -1;
    var type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') return -1;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    var name = (el.getAttribute('name') || '').toLowerCase();
    var id = (el.getAttribute('id') || '').toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    var haystack = name + ' ' + id + ' ' + aria;
    if (ac === 'username') return 100;
    if (ac === 'email') return 98;
    if (type === 'email') return 95;
    if (name === 'loginfmt' || id === 'loginfmt') return 94;
    if (haystack.indexOf('email') >= 0) return 90;
    if (haystack.indexOf('username') >= 0 || haystack.indexOf('user-name') >= 0) return 88;
    if (haystack.indexOf('login') >= 0 || haystack.indexOf('signin') >= 0 || haystack.indexOf('sign-in') >= 0) return 84;
    if (type === 'tel' && (haystack.indexOf('phone') >= 0 || haystack.indexOf('mobile') >= 0)) return 80;
    return -1;
  }

  function findUsernameInput() {
    var inputs = document.querySelectorAll('input');
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < inputs.length; i++) {
      var score = usernameScore(inputs[i]);
      if (score > bestScore) {
        best = inputs[i];
        bestScore = score;
      }
    }
    return bestScore >= 80 ? best : null;
  }

  function findPasswordInput() {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      if (isPasswordInput(inputs[i]) && isVisible(inputs[i])) return inputs[i];
    }
    return null;
  }

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

    var usernameEl = findUsernameInput();
    var passwordEl = findPasswordInput();
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
