/** Injected into site tab webviews: hooks, in-page prompt UI, and state polling. */

export const PASSWORD_HOOK_VERSION = 4

const LABELS = {
  tr: {
    fillTitle: 'Kayıtlı şifre',
    fillLead: 'için kayıtlı giriş var',
    fillBtn: 'Doldur',
    saveTitle: 'Şifreyi kaydet?',
    saveLead: 'girişini kaydedelim mi?',
    saveBtn: 'Kaydet',
    dismiss: 'Hayır',
  },
  en: {
    fillTitle: 'Saved password',
    fillLead: 'saved sign-in for',
    fillBtn: 'Fill',
    saveTitle: 'Save password?',
    saveLead: 'save sign-in for',
    saveBtn: 'Save',
    dismiss: 'No',
  },
} as const

export interface BridgePromptConfig {
  mode: 'fill' | 'save'
  site: string
  user?: string
  accounts?: string[]
}

export interface PasswordBridgePollResult {
  pending?: {
    type: string
    username: string
    password: string
    url: string
    t: number
  } | null
  hasForm?: boolean
  href?: string
  error?: string
  action?: {
    type: 'fill' | 'save' | 'dismiss'
    username?: string
  } | null
}

export function buildPasswordBridgeTickScript(
  locale: 'tr' | 'en',
  prompt: BridgePromptConfig | null,
): string {
  const labels = LABELS[locale]
  const promptJson = JSON.stringify(prompt)
  const labelsJson = JSON.stringify(labels)

  return `
(function() {
  var PROMPT_CFG = ${promptJson};
  var LABELS = ${labelsJson};
  var HOOK_V = ${PASSWORD_HOOK_VERSION};

  function isVisible(el) {
    try {
      if (!el) return false;
      if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (e) {
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

  function isUsernameInput(el, password) {
    if (!el || el === password || el.tagName !== 'INPUT') return false;
    if (isPasswordInput(el)) return false;
    var type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') return false;
    if (type === 'email' || type === 'text' || type === 'tel') return true;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac === 'username' || ac === 'email') return true;
    var name = (el.getAttribute('name') || '').toLowerCase();
    var id = (el.getAttribute('id') || '').toLowerCase();
    var aria = (el.getAttribute('aria-label') || '').toLowerCase();
    return name.indexOf('user') >= 0 || name.indexOf('email') >= 0 || name.indexOf('login') >= 0
      || id.indexOf('user') >= 0 || id.indexOf('email') >= 0 || id.indexOf('login') >= 0
      || aria.indexOf('user') >= 0 || aria.indexOf('email') >= 0 || aria.indexOf('phone') >= 0;
  }

  function findLoginFields() {
    var passwords = document.querySelectorAll('input');
    var password = null;
    for (var p = 0; p < passwords.length; p++) {
      if (isPasswordInput(passwords[p]) && isVisible(passwords[p])) {
        password = passwords[p];
        break;
      }
    }
    if (!password) return null;

    var username = null;
    var form = password.closest('form');
    var scope = form ? form.querySelectorAll('input') : document.querySelectorAll('input');

    for (var i = 0; i < scope.length; i++) {
      var input = scope[i];
      if (!isUsernameInput(input, password) || !isVisible(input)) continue;
      if (form || (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        username = input;
        break;
      }
    }

    if (!username) return null;
    return { username: username, password: password };
  }

  function capturePending(reason) {
    var fields = findLoginFields();
    if (!fields) return;
    var user = (fields.username.value || '').trim();
    var pass = fields.password.value || '';
    if (!user || !pass) return;
    window.__nebulaPendingCreds = {
      type: reason,
      username: user,
      password: pass,
      url: location.href,
      t: Date.now()
    };
  }

  if (window.__nebulaPwdHookV !== HOOK_V) {
    window.__nebulaPwdHookV = HOOK_V;
    document.addEventListener('submit', function() { capturePending('submit'); }, true);
    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var btn = target.closest('button, input[type="submit"], [role="button"]');
      if (!btn) return;
      window.setTimeout(function() { capturePending('click'); }, 180);
    }, true);
  }

  function removePrompt() {
    var existing = document.getElementById('nebula-pwd-banner');
    if (existing) existing.remove();
  }

  function renderPrompt() {
    var cfgKey = PROMPT_CFG ? JSON.stringify(PROMPT_CFG) : '';
    if (!PROMPT_CFG) {
      window.__nebulaPromptKey = '';
      removePrompt();
      return;
    }
    if (window.__nebulaPromptKey === cfgKey && document.getElementById('nebula-pwd-banner')) {
      return;
    }
    window.__nebulaPromptKey = cfgKey;
    removePrompt();

    var root = document.createElement('div');
    root.id = 'nebula-pwd-banner';
    root.setAttribute('data-nebula-safe', '1');
    root.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483646;font-family:Segoe UI,system-ui,sans-serif;';

    var card = document.createElement('div');
    card.style.cssText = 'max-width:420px;margin:0 auto;padding:14px 16px;border-radius:14px;border:1px solid rgba(134,59,255,0.45);background:rgba(12,10,20,0.96);color:#ede6ff;box-shadow:0 12px 40px rgba(0,0,0,0.45);';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:4px;';
    title.textContent = PROMPT_CFG.mode === 'fill' ? LABELS.fillTitle : LABELS.saveTitle;

    var lead = document.createElement('div');
    lead.style.cssText = 'font-size:13px;color:#b7aacf;margin-bottom:12px;line-height:1.4;';
    if (PROMPT_CFG.mode === 'fill') {
      lead.textContent = PROMPT_CFG.site + ' ' + LABELS.fillLead;
    } else {
      lead.textContent = PROMPT_CFG.site + ' — ' + (PROMPT_CFG.user || '') + ' ' + LABELS.saveLead;
    }

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;';

    function makeBtn(text, primary, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.style.cssText = primary
        ? 'border:none;border-radius:10px;padding:8px 14px;background:#863bff;color:#fff;font-weight:600;cursor:pointer;'
        : 'border:none;border-radius:10px;padding:8px 14px;background:transparent;color:#c9bddf;cursor:pointer;';
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    actions.appendChild(makeBtn(LABELS.dismiss, false, function() {
      window.__nebulaPwdUserAction = { type: 'dismiss' };
      removePrompt();
    }));

    if (PROMPT_CFG.mode === 'fill' && PROMPT_CFG.accounts && PROMPT_CFG.accounts.length > 1) {
      for (var a = 0; a < PROMPT_CFG.accounts.length; a++) {
        (function(username) {
          actions.appendChild(makeBtn(username, true, function() {
            window.__nebulaPwdUserAction = { type: 'fill', username: username };
            removePrompt();
          }));
        })(PROMPT_CFG.accounts[a]);
      }
    } else {
      actions.appendChild(makeBtn(PROMPT_CFG.mode === 'fill' ? LABELS.fillBtn : LABELS.saveBtn, true, function() {
        window.__nebulaPwdUserAction = {
          type: PROMPT_CFG.mode === 'fill' ? 'fill' : 'save',
          username: PROMPT_CFG.user || (PROMPT_CFG.accounts && PROMPT_CFG.accounts[0]) || undefined
        };
        removePrompt();
      }));
    }

    card.appendChild(title);
    card.appendChild(lead);
    card.appendChild(actions);
    root.appendChild(card);
    document.documentElement.appendChild(root);
  }

  try {
    renderPrompt();
    var pending = window.__nebulaPendingCreds || null;
    if (pending) window.__nebulaPendingCreds = null;
    var action = window.__nebulaPwdUserAction || null;
    if (action) window.__nebulaPwdUserAction = null;
    var hasForm = !!findLoginFields();
    var href = location.href || '';
    if (href.indexOf('http') !== 0) {
      return JSON.stringify({ pending: null, hasForm: false, href: href, action: action });
    }
    return JSON.stringify({ pending: pending, hasForm: hasForm, href: href, action: action });
  } catch (error) {
    return JSON.stringify({ error: String(error), href: location.href || '', hasForm: false, action: null });
  }
})()
`.trim()
}

export function buildPasswordFillScript(username: string, password: string): string {
  const u = JSON.stringify(username)
  const p = JSON.stringify(password)
  return `
(function() {
  function setReactFriendlyValue(element, value) {
    if (!element) return;
    try {
      var proto = element.constructor && element.constructor.prototype;
      var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
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
    } catch (err) {
      element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function armFillGuard(element, value) {
    if (!element || element.__nebulaFillGuard) return;
    element.__nebulaFillGuard = true;
    function restore() {
      if (element.value !== value) setReactFriendlyValue(element, value);
    }
    element.addEventListener('focus', restore);
    element.addEventListener('blur', restore);
    element.addEventListener('click', restore);
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  try {
    var password = null;
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = (el.type || '').toLowerCase();
      var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      if ((type === 'password' || ac === 'current-password') && isVisible(el)) {
        password = el;
        break;
      }
    }
    if (!password) return false;

    var username = null;
    var form = password.closest('form');
    var scope = form ? form.querySelectorAll('input') : document.querySelectorAll('input');
    for (var j = 0; j < scope.length; j++) {
      var candidate = scope[j];
      if (candidate === password || !isVisible(candidate)) continue;
      var ctype = (candidate.type || '').toLowerCase();
      if (ctype === 'password' || ctype === 'hidden' || ctype === 'checkbox' || ctype === 'radio') continue;
      if (ctype === 'email' || ctype === 'text' || ctype === 'tel') {
        var ac2 = (candidate.getAttribute('autocomplete') || '').toLowerCase();
        var name = (candidate.getAttribute('name') || '').toLowerCase();
        if (ac2 === 'username' || ac2 === 'email' || name.indexOf('user') >= 0 || name.indexOf('email') >= 0 || name.indexOf('login') >= 0) {
          if (form || (candidate.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            username = candidate;
            break;
          }
        }
      }
    }
    if (!username) return false;

    var userValue = ${u};
    var passValue = ${p};

    username.focus();
    setReactFriendlyValue(username, userValue);
    armFillGuard(username, userValue);
    username.dispatchEvent(new Event('blur', { bubbles: true }));

    window.setTimeout(function() {
      setReactFriendlyValue(username, userValue);
      setReactFriendlyValue(password, passValue);
      armFillGuard(password, passValue);
      password.focus();

      window.setTimeout(function() {
        if (username.value !== userValue) setReactFriendlyValue(username, userValue);
      }, 100);

      window.setTimeout(function() {
        if (username.value !== userValue) setReactFriendlyValue(username, userValue);
        if (password.value !== passValue) setReactFriendlyValue(password, passValue);
      }, 350);
    }, 150);

    return true;
  } catch (e) {
    return false;
  }
})()
`.trim()
}

export function buildPasswordPromptDismissScript(): string {
  return `(function(){var el=document.getElementById('nebula-pwd-banner');if(el)el.remove();return true;})()`
}

export function parsePasswordBridgePoll(raw: string): PasswordBridgePollResult | null {
  if (!raw?.trim()) return null
  try {
    const unwrapped = JSON.parse(raw) as unknown
    const json =
      typeof unwrapped === 'string'
        ? (JSON.parse(unwrapped) as PasswordBridgePollResult)
        : (unwrapped as PasswordBridgePollResult)
    return json
  } catch {
    return null
  }
}
