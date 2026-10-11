/**
 * Credential field detection shared, as source text, by every script Nebula injects into a site: the polling
 * bridge, the fill script and the native submit capture in `src-tauri/src/site_ui.rs`. They used to carry three
 * slightly different copies, so a form could be saved under one rule and then not filled under another.
 *
 * The text is ES5 without backslashes or double quotes so it can sit inside a TypeScript template literal and a
 * Rust raw string alike. `tests/password-fields.test.ts` checks that the Rust copy is identical.
 */
export const PASSWORD_FIELD_DETECTION_SOURCE = `
  var DOTTED_I = new RegExp(String.fromCharCode(775), 'g');

  function foldText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(DOTTED_I, '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  // Every input of the page, including those inside open shadow roots.
  function allInputs(root) {
    var found = [];
    var budget = 6000;
    (function walk(node) {
      var direct = node.querySelectorAll('input');
      for (var i = 0; i < direct.length; i++) found.push(direct[i]);
      if (budget <= 0) return;
      var all = node.querySelectorAll('*');
      budget -= all.length;
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) walk(all[j].shadowRoot);
      }
    })(root || document);
    return found;
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
    if (type === 'password') return true;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return ac === 'current-password' || ac === 'new-password';
  }

  function isNewPasswordInput(el) {
    return (el.getAttribute('autocomplete') || '').toLowerCase() === 'new-password';
  }

  function usernameScore(el) {
    if (!el || el.tagName !== 'INPUT' || !isVisible(el) || isPasswordInput(el)) return -1;
    var type = (el.type || '').toLowerCase();
    if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button' || type === 'search') return -1;
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    var name = foldText(el.getAttribute('name'));
    var id = foldText(el.getAttribute('id'));
    var haystack = name + ' ' + id + ' ' + foldText(el.getAttribute('aria-label')) + ' ' + foldText(el.getAttribute('placeholder'));
    if (/(search|query|filter|arama)/.test(haystack)) return -1;
    if (ac === 'username') return 100;
    if (ac === 'email') return 98;
    if (type === 'email') return 95;
    if (name === 'loginfmt' || id === 'loginfmt' || name === 'identifier' || id === 'identifier') return 94;
    if (/(e-?mail|eposta|e-posta)/.test(haystack)) return 90;
    if (/(user-?name|user_name|user-?id|user_id|userid|uname|kullanici|tckn|tc ?kimlik|ogrenci|sicil|account|hesap)/.test(haystack)) return 88;
    if (/(login|signin|sign-in|sign_in|giris)/.test(haystack)) return 84;
    if (/user/.test(haystack)) return 82;
    if (type === 'tel' && /(phone|mobile|telefon|gsm|cep)/.test(haystack)) return 80;
    return -1;
  }

  function findUsernameInput(inputs) {
    var list = inputs || allInputs(document);
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var score = usernameScore(list[i]);
      if (score > bestScore) {
        best = list[i];
        bestScore = score;
      }
    }
    return bestScore >= 80 ? best : null;
  }

  function visiblePasswordInputs() {
    var list = allInputs(document);
    var visible = [];
    for (var i = 0; i < list.length; i++) {
      if (isPasswordInput(list[i]) && isVisible(list[i])) visible.push(list[i]);
    }
    return visible;
  }

  // The field a saved password belongs in: the first one that is not marked as a new password. A page that only
  // has new-password fields is a sign-up or a password change, where a saved password is not offered.
  function findPasswordInput() {
    var list = visiblePasswordInputs();
    for (var i = 0; i < list.length; i++) {
      if (!isNewPasswordInput(list[i])) return list[i];
    }
    return null;
  }

  // The password to remember after a submit. A form with a new-password field (or three password fields:
  // current, new, confirm) is a password change: the new one is what must be saved, not the old one.
  function findPasswordToSave() {
    var list = visiblePasswordInputs();
    for (var i = 0; i < list.length; i++) {
      if (isNewPasswordInput(list[i])) return list[i];
    }
    if (list.length >= 3) return list[1];
    return list.length > 0 ? list[0] : null;
  }

  function isPasswordChangeForm() {
    var list = visiblePasswordInputs();
    if (list.length >= 3) return true;
    var hasNew = false;
    var hasCurrent = false;
    for (var i = 0; i < list.length; i++) {
      if (isNewPasswordInput(list[i])) hasNew = true;
      else hasCurrent = true;
    }
    return hasNew && hasCurrent;
  }

  // The account field that belongs to a password field: the best-scoring one in its form, or, for an old form
  // that gives no hints, the only text field in front of the password.
  function findUsernameFor(password) {
    if (!password) return null;
    var form = password.closest && password.closest('form');
    var scope = allInputs(form || password.getRootNode());
    var username = findUsernameInput(scope);
    if (username || !form) return username;
    var candidates = [];
    for (var i = 0; i < scope.length; i++) {
      var input = scope[i];
      if (!input || input === password || !isVisible(input) || isPasswordInput(input)) continue;
      var type = (input.type || '').toLowerCase();
      if (type !== 'text' && type !== 'email' && type !== 'tel') continue;
      if (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) candidates.push(input);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
`
