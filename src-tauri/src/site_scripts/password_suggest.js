// Inline account suggestions under a sign-in field (the list a person sees when they click the account box).
//
// Runs at document start in the top frame of http(s) tabs. What it knows is only what the shell hands it:
// the user names saved for this site. Passwords never come here: a pick is reported to the shell, which checks
// the origin and the name against its own list and fills the form itself. The list is drawn in a closed shadow
// root so the page cannot read it, and only a real (trusted) click or key chooses an account.
//
// The part before "the page" is plain logic with no DOM; tests/password-suggest.test.ts runs it in Node.
(function () {
  'use strict';


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

  // ---- The rules of the list ----

  var VISIBLE_ROWS = 5;

  // The accounts to show for what has been typed: all of them for an empty box, otherwise those that contain the
  // text (the ones that start with it first). An account that is exactly what was typed is not offered again.
  // Passkeys (a sign-in the page asked for with passkey suggestions) follow the accounts, each as { name, passkey:
  // credential id }: they match the same way, but a passkey whose name is exactly what was typed is still offered.
  function suggestionRows(accounts, typed, passkeys) {
    var needle = foldText(typed).trim();
    var rows = [];
    var keys = passkeys || [];
    var i;
    if (!needle) {
      for (i = 0; i < accounts.length; i++) rows.push({ name: accounts[i], at: -1, length: 0 });
      for (i = 0; i < keys.length; i++) rows.push({ name: keys[i].name, at: -1, length: 0, passkey: keys[i].id });
      return rows;
    }
    var starts = [];
    var inside = [];
    for (i = 0; i < accounts.length; i++) {
      var folded = foldText(accounts[i]);
      var at = folded.indexOf(needle);
      if (at === -1 || folded === needle) continue;
      (at === 0 ? starts : inside).push({ name: accounts[i], at: at, length: needle.length });
    }
    var keyRows = [];
    for (i = 0; i < keys.length; i++) {
      var keyAt = foldText(keys[i].name).indexOf(needle);
      if (keyAt === -1) continue;
      keyRows.push({ name: keys[i].name, at: keyAt, length: needle.length, passkey: keys[i].id });
    }
    return starts.concat(inside, keyRows);
  }

  // What the list does for each thing that happens. view = { open, rows, active }.
  //  open   the field was clicked or focused: everything that fits what is typed, which is the whole list for an
  //         empty box and nothing (so no list) for text that is none of the accounts
  //  input  something was typed: an emptied box closes the list (it comes back with the next click), text that
  //         is part of an account narrows it, text that is none of them closes it
  //  down / up / enter / escape   the keyboard; enter only chooses a row that was moved to
  function nextView(view, event, accounts, typed, passkeys) {
    var open = view.open;
    var rows = view.rows;
    var active = view.active;
    var pick = null;
    var pickRow = null;
    var consumed = false;
    if (event === 'open') {
      rows = suggestionRows(accounts, typed, passkeys);
      open = rows.length > 0;
      active = -1;
    } else if (event === 'input') {
      rows = String(typed || '').trim() ? suggestionRows(accounts, typed, passkeys) : [];
      open = rows.length > 0;
      active = -1;
    } else if (event === 'down') {
      if (!open) {
        rows = suggestionRows(accounts, typed, passkeys);
        open = rows.length > 0;
        active = open ? 0 : -1;
        consumed = open;
      } else {
        active = (active + 1) % rows.length;
        consumed = true;
      }
    } else if (event === 'up') {
      if (open) {
        active = active <= 0 ? rows.length - 1 : active - 1;
        consumed = true;
      }
    } else if (event === 'escape') {
      if (open) {
        open = false;
        consumed = true;
      }
    } else if (event === 'enter') {
      if (open && active >= 0 && active < rows.length) {
        pick = rows[active].name;
        pickRow = rows[active];
        open = false;
        consumed = true;
      }
    } else if (event === 'accounts') {
      if (open) {
        rows = suggestionRows(accounts, typed, passkeys);
        if (rows.length === 0) open = false;
        if (active >= rows.length) active = -1;
      }
    } else if (event === 'close' || event === 'blur') {
      open = false;
    }
    if (!open) {
      rows = [];
      active = -1;
    }
    return { open: open, rows: rows, active: active, pick: pick, pickRow: pickRow, consumed: consumed };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module === 'object' && module && module.exports) {
      module.exports = { suggestionRows: suggestionRows, nextView: nextView, VISIBLE_ROWS: VISIBLE_ROWS, siteNameFrom: siteNameFrom };
    }
    return;
  }

  // The name of a site for the heading of the list: what the site calls itself (og:site_name, application-name), or else its
  // domain name without "www." and the suffix, with a capital ("lichess.org" gives "Lichess", "www.bbc.co.uk" gives "Bbc").
  function siteNameFrom(declared, hostname) {
    var SECOND_LEVEL = { co: 1, com: 1, org: 1, net: 1, gov: 1, edu: 1, ac: 1, or: 1, ne: 1, go: 1, gen: 1, av: 1, k12: 1, web: 1, bel: 1, mil: 1, biz: 1, info: 1 };
    var name = typeof declared === 'string' ? declared.replace(/\s+/g, ' ').trim() : '';
    if (name && name.length <= 40) return name;
    var host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    // An address, not a name.
    if (!host || /^[0-9.]+$/.test(host) || host.indexOf(':') >= 0) return host;
    var labels = host.split('.').filter(Boolean);
    if (labels.length === 0) return '';
    var index = labels.length - 2;
    if (labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL[labels[labels.length - 2]]) {
      index = labels.length - 3;
    }
    var label = index >= 0 ? labels[index] : labels[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  // ---- The page ----

  if (window.top !== window) return;
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
  var bridge = window.chrome && window.chrome.webview;
  if (!bridge || typeof bridge.postMessage !== 'function') return;
  var attachShadowOf = Element.prototype.attachShadow;
  if (typeof attachShadowOf !== 'function') return;

  var accounts = [];
  // The passkeys Windows has for this site, while the page has asked for passkey suggestions: { id, name }.
  var passkeys = [];
  var labels = { all: '{count}', filtered: '{count}', passkey: 'Passkey' };
  var field = null;
  var fieldKind = 'username';
  var view = { open: false, rows: [], active: -1 };
  // Set when the person closed the list or typed something else: the list then does not open by itself when the
  // accounts arrive late. A new click or focus clears it.
  var quiet = false;
  var ui = null;
  var lastWantedAt = 0;
  var frame = 0;
  // After a pick the shell fills the form and may move the focus; that must not open the list again.
  var holdUntil = 0;

  function post(message) {
    try {
      bridge.postMessage(JSON.stringify(message));
    } catch (_) {}
  }

  function deepTarget(event) {
    try {
      var path = event.composedPath && event.composedPath();
      if (path && path.length) return path[0];
    } catch (_) {}
    return event.target;
  }

  // The field a list belongs to: the account box of the sign-in form, or, on a page that only asks for the
  // password (the second step of a split sign-in), that password box.
  function suggestionKind(element) {
    if (!element || element.tagName !== 'INPUT' || !isVisible(element)) return null;
    var user = findUsernameInput();
    if (user) return user === element ? 'username' : null;
    return isPasswordInput(element) && findPasswordInput() === element ? 'password' : null;
  }

  function typedText() {
    // Text typed into a password box is never read.
    return field && fieldKind === 'username' ? String(field.value || '') : '';
  }

  function activeElement() {
    var element = document.activeElement;
    while (element && element.shadowRoot && element.shadowRoot.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  // The colours of Nebula's interface (the theme and the palette), handed over by the shell with each message and put on
  // the two surfaces below as custom properties. The colours in the style sheets are only what is used when the shell sends
  // none (then the page's own light or dark preference decides).
  var pageTheme = null;
  var THEME_KEYS = ['card', 'text', 'muted', 'border', 'field', 'surface', 'accent', 'strong', 'ink', 'on', 'soft', 'softBorder'];

  // Only a colour is taken: a short value made of the characters a colour is written with.
  function colourValue(value) {
    return typeof value === 'string' && value.length <= 120 && /^[a-zA-Z0-9#(),.%\s\/-]+$/.test(value) ? value : '';
  }

  function applyTheme(host) {
    if (!host || !pageTheme) return;
    for (var i = 0; i < THEME_KEYS.length; i++) {
      var value = pageTheme[THEME_KEYS[i]];
      if (value) host.style.setProperty('--nb-' + THEME_KEYS[i], value);
    }
    host.style.setProperty('--nb-shadow', pageTheme.dark ? '0 14px 36px rgba(0, 0, 0, 0.55)' : '0 14px 36px rgba(31, 41, 90, 0.22)');
    host.setAttribute('data-themed', '');
    if (pageTheme.dark) host.setAttribute('data-dark', '');
    else host.removeAttribute('data-dark');
  }

  function setTheme(raw) {
    if (!raw || typeof raw !== 'object') return;
    var next = { dark: raw.dark === true };
    var any = false;
    for (var i = 0; i < THEME_KEYS.length; i++) {
      next[THEME_KEYS[i]] = colourValue(raw[THEME_KEYS[i]]);
      if (next[THEME_KEYS[i]]) any = true;
    }
    if (!any) return;
    pageTheme = next;
    applyTheme(ui && ui.host);
    applyTheme(bubble && bubble.host);
  }

  // What the page calls itself, if it says.
  function pageSiteName() {
    var meta = null;
    try {
      meta = document.querySelector('meta[property="og:site_name"], meta[name="application-name"]');
    } catch (_) {}
    return siteNameFrom(meta && meta.getAttribute('content'), window.location.hostname);
  }

  function ensureUi() {
    if (ui) return ui;
    var host = document.createElement('div');
    var root = attachShadowOf.call(host, { mode: 'closed' });
    applyTheme(host);
    var css = [
      ':host { all: initial; }',
      '.panel { position: fixed; z-index: 2147483647; box-sizing: border-box; display: none; overflow: hidden;',
      '  border-radius: 14px; border: 1px solid var(--nb-border, #d6d8e0); background: var(--nb-card, #ffffff); color: var(--nb-text, #1b1d27);',
      '  box-shadow: var(--nb-shadow, 0 12px 32px rgba(15, 18, 32, 0.22)); font: 13px/1.35 system-ui, "Segoe UI", sans-serif; }',
      '.head { display: flex; align-items: center; gap: 6px; padding: 8px 12px 6px; font-size: 11px; color: var(--nb-muted, #6b6f82); }',
      '.head b { color: var(--nb-ink, #4f46e5); font-weight: 600; }',
      '.list { max-height: ' + VISIBLE_ROWS * 44 + 'px; overflow-y: auto; scrollbar-width: thin; padding: 0 4px 4px; }',
      '.row { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 8px; border-radius: 8px; cursor: pointer; }',
      '.row.active { background: var(--nb-soft, #eef0ff); }',
      '.avatar { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;',
      '  background: var(--nb-soft, #e0e3ff); color: var(--nb-ink, #4338ca); font-size: 12px; font-weight: 600; }',
      '.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.name mark { background: none; color: var(--nb-ink, #4f46e5); font-weight: 700; }',
      '.kind { flex: none; margin-left: auto; font-size: 11px; color: var(--nb-muted, #6b6f82); }',
      ':host([data-dark]) .list { color-scheme: dark; }',
      // Without colours from the shell, the page's own dark preference decides.
      '@media (prefers-color-scheme: dark) {',
      '  :host(:not([data-themed])) .panel { background: #1f2130; color: #eceefa; border-color: #3a3d54; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); }',
      '  :host(:not([data-themed])) .list { color-scheme: dark; }',
      '  :host(:not([data-themed])) .head { color: #9a9eb8; } :host(:not([data-themed])) .head b { color: #a5a8ff; }',
      '  :host(:not([data-themed])) .row.active { background: #2c2f4a; } :host(:not([data-themed])) .avatar { background: #34376a; color: #c7c9ff; }',
      '  :host(:not([data-themed])) .name mark { color: #a5a8ff; } :host(:not([data-themed])) .kind { color: #9a9eb8; }',
      '}'
    ].join('\n');
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      var style = document.createElement('style');
      style.textContent = css;
      root.appendChild(style);
    }
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'listbox');
    var head = document.createElement('div');
    head.className = 'head';
    var list = document.createElement('div');
    list.className = 'list';
    panel.appendChild(head);
    panel.appendChild(list);
    // Clicking a row must not take the focus from the field.
    panel.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });
    root.appendChild(panel);
    ui = { host: host, panel: panel, head: head, list: list };
    return ui;
  }

  function hideUi() {
    if (ui) ui.panel.style.display = 'none';
  }

  function place() {
    frame = 0;
    if (!view.open || !field || !ui) return;
    if (!isVisible(field)) {
      view = nextView(view, 'close', accounts, '', passkeys);
      hideUi();
      return;
    }
    var rect = field.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var width = Math.min(Math.max(rect.width, 260), vw - 16);
    var left = Math.min(Math.max(8, rect.left), vw - width - 8);
    ui.panel.style.width = width + 'px';
    ui.panel.style.left = left + 'px';
    var height = ui.panel.offsetHeight;
    var below = rect.bottom + 4;
    var top = below + height > vh - 8 && rect.top - 4 - height > 8 ? rect.top - 4 - height : below;
    ui.panel.style.top = top + 'px';
  }

  function schedulePlace() {
    if (!frame) frame = window.requestAnimationFrame(place);
  }

  function highlight(row) {
    var text = document.createDocumentFragment();
    var name = row.name;
    if (row.at >= 0) {
      var end = Math.min(name.length, row.at + row.length);
      if (row.at > 0) text.appendChild(document.createTextNode(name.slice(0, row.at)));
      var mark = document.createElement('mark');
      mark.textContent = name.slice(row.at, end);
      text.appendChild(mark);
      if (end < name.length) text.appendChild(document.createTextNode(name.slice(end)));
    } else {
      text.appendChild(document.createTextNode(name));
    }
    return text;
  }

  function render() {
    if (!view.open || !field) {
      hideUi();
      return;
    }
    var parts = ensureUi();
    if (!parts.host.isConnected) (document.documentElement || document).appendChild(parts.host);
    var filtered = typedText().trim() !== '';
    var template = filtered ? labels.filtered : labels.all;
    parts.head.textContent = '';
    var brand = document.createElement('b');
    brand.textContent = pageSiteName() || 'Nebula';
    parts.head.appendChild(brand);
    parts.head.appendChild(
      document.createTextNode(' · ' + template.replace('{count}', String(filtered ? view.rows.length : accounts.length + passkeys.length)))
    );
    parts.list.textContent = '';
    var rows = view.rows;
    for (var i = 0; i < rows.length; i++) {
      (function (index) {
        var row = document.createElement('div');
        row.className = 'row' + (index === view.active ? ' active' : '');
        row.setAttribute('role', 'option');
        var avatar = document.createElement('span');
        avatar.className = 'avatar';
        if (rows[index].passkey) {
          avatar.appendChild(keyIcon());
        } else {
          avatar.textContent = (rows[index].name.trim().slice(0, 1) || '?').toUpperCase();
        }
        var name = document.createElement('span');
        name.className = 'name';
        name.appendChild(highlight(rows[index]));
        row.appendChild(avatar);
        row.appendChild(name);
        if (rows[index].passkey) {
          var kind = document.createElement('span');
          kind.className = 'kind';
          kind.textContent = labels.passkey;
          row.appendChild(kind);
        }
        row.addEventListener('mousemove', function () {
          if (view.active === index) return;
          view = { open: view.open, rows: view.rows, active: index, pick: null, consumed: false };
          var current = parts.list.querySelector('.active');
          if (current) current.className = 'row';
          row.className = 'row active';
        });
        row.addEventListener('click', function (event) {
          if (event.isTrusted) choose(rows[index]);
        });
        parts.list.appendChild(row);
      })(i);
    }
    parts.panel.style.display = 'block';
    place();
    var activeRow = parts.list.querySelector('.active');
    if (activeRow && activeRow.scrollIntoView) activeRow.scrollIntoView({ block: 'nearest' });
  }

  function hasChoices() {
    return accounts.length + passkeys.length > 0;
  }

  function dispatch(event) {
    view = nextView(view, event, accounts, typedText(), passkeys);
    render();
    return view;
  }

  function choose(row) {
    view = nextView(view, 'close', accounts, '', passkeys);
    quiet = true;
    holdUntil = Date.now() + 2000;
    render();
    if (row.passkey) {
      signWithPasskey(row.passkey);
      return;
    }
    post({
      type: 'nebula-password-suggest',
      kind: 'pick',
      origin: window.location.origin,
      url: window.location.href,
      username: row.name
    });
  }

  function wantAccounts() {
    var now = Date.now();
    if (now - lastWantedAt < 1500) return;
    lastWantedAt = now;
    post({
      type: 'nebula-password-suggest',
      kind: 'wanted',
      origin: window.location.origin,
      url: window.location.href,
      username: ''
    });
  }

  // The web view's own drop-down of remembered entries ("Saved info") must not open over Nebula's list. It honours
  // autocomplete="off" on the form, so the sign-in form gets it. Only the form is marked, never the field: the field
  // detection reads the field's own autocomplete value (username, email, current-password).
  function quietNativeSuggestions(element) {
    try {
      var form = element.form;
      if (form) {
        if (String(form.getAttribute('autocomplete') || '').toLowerCase() !== 'off') form.setAttribute('autocomplete', 'off');
      } else if (!element.getAttribute('autocomplete')) {
        element.setAttribute('autocomplete', 'off');
      }
    } catch (_) {}
  }

  function engage(element) {
    var kind = suggestionKind(element);
    if (!kind) return false;
    field = element;
    fieldKind = kind;
    quietNativeSuggestions(element);
    return true;
  }

  // Before the field takes the focus, so the web view has not yet decided to show its own list.
  window.addEventListener('pointerdown', function (event) {
    var target = deepTarget(event);
    if (target && target.tagName === 'INPUT' && suggestionKind(target)) quietNativeSuggestions(target);
  }, true);

  window.addEventListener('focusin', function (event) {
    var target = deepTarget(event);
    if (!engage(target)) {
      if (view.open) dispatch('close');
      return;
    }
    if (Date.now() < holdUntil) return;
    quiet = false;
    if (!hasChoices()) {
      wantAccounts();
      return;
    }
    dispatch('open');
  }, true);

  window.addEventListener('click', function (event) {
    if (!event.isTrusted) return;
    var target = deepTarget(event);
    if (target !== field && !engage(target)) return;
    if (Date.now() < holdUntil) return;
    quiet = false;
    if (!hasChoices()) {
      wantAccounts();
      return;
    }
    dispatch('open');
  }, true);

  window.addEventListener('input', function (event) {
    if (!event.isTrusted || deepTarget(event) !== field) return;
    quiet = true;
    dispatch(fieldKind === 'password' ? 'close' : 'input');
  }, true);

  window.addEventListener('focusout', function (event) {
    if (deepTarget(event) === field && view.open) dispatch('blur');
  }, true);

  window.addEventListener('keydown', function (event) {
    if (!event.isTrusted || deepTarget(event) !== field) return;
    var name = null;
    if (event.key === 'ArrowDown') name = 'down';
    else if (event.key === 'ArrowUp') name = 'up';
    else if (event.key === 'Escape') name = 'escape';
    else if (event.key === 'Enter') name = 'enter';
    else if (event.key === 'Tab' && view.open) dispatch('close');
    if (!name || (!view.open && name !== 'down')) return;
    if (name === 'down' && !hasChoices()) return;
    var result = dispatch(name);
    if (name === 'escape' && result.consumed) quiet = true;
    if (result.consumed) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (result.pickRow) choose(result.pickRow);
  }, true);

  window.addEventListener('scroll', function () {
    if (view.open) schedulePlace();
  }, true);
  window.addEventListener('resize', function () {
    if (view.open) schedulePlace();
  });

  // The shell hands over the accounts (user names only) and the words for the list's heading. It cannot be
  // replaced by the page: it is defined before the page's own scripts run.
  function receive(raw) {
    var data;
    try {
      data = JSON.parse(String(raw));
    } catch (_) {
      return 'invalid';
    }
    if (data && data.theme) setTheme(data.theme);
    var list = [];
    if (data && Array.isArray(data.accounts)) {
      for (var i = 0; i < data.accounts.length && list.length < 200; i++) {
        var name = data.accounts[i];
        if (typeof name === 'string' && name) list.push(name.slice(0, 320));
      }
    }
    if (data && data.labels) {
      if (typeof data.labels.all === 'string') labels.all = data.labels.all.slice(0, 120);
      if (typeof data.labels.filtered === 'string') labels.filtered = data.labels.filtered.slice(0, 120);
      if (typeof data.labels.passkey === 'string') labels.passkey = data.labels.passkey.slice(0, 40);
    }
    accounts = list;
    if (!hasChoices()) {
      dispatch('close');
      return 'ok';
    }
    var focused = activeElement();
    if (focused && focused !== field) engage(focused);
    if (field && focused === field && !view.open && !quiet && typedText().trim() === '') dispatch('open');
    else dispatch('accounts');
    return 'ok';
  }

  // ---- Passkeys ----
  //
  // A page that wants to suggest passkeys asks for a "conditional" sign-in, which the web view answers with its own
  // pop-up ("Saved passkeys"). Nebula answers it itself: it asks Windows which passkeys it has for the site, lists
  // them with the accounts, and, when one is chosen, has Windows sign in with it. The native side checks the
  // site and the credential (nothing the page says is trusted for who is asking), builds the signed data with the
  // real origin and hands back the answer, which becomes the normal credential object for the page.
  // Without passkeys for the site, or when anything fails, the web view's own request runs as it always did.

  var pendingKey = null;
  var keyRequests = 0;

  function bytesOf(source) {
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return null;
  }

  function toBase64Url(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(text) {
    var padded = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    var binary = window.atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function domError(name, message) {
    try {
      return new DOMException(message, name);
    } catch (_) {
      var error = new Error(message);
      error.name = name;
      return error;
    }
  }

  function endKeyRequest() {
    pendingKey = null;
    if (passkeys.length) {
      passkeys = [];
      if (view.open) dispatch('accounts');
    }
  }

  function failKeyRequest(request, name, message) {
    if (pendingKey !== request) return;
    endKeyRequest();
    request.reject(domError(name, message));
  }

  function conditionalGet(options, originalGet, container) {
    var publicKey = options.publicKey;
    var challenge = bytesOf(publicKey.challenge);
    var rpId = String(publicKey.rpId || window.location.hostname || '').toLowerCase();
    if (!challenge || !rpId) return originalGet.call(container, options);
    return new Promise(function (resolve, reject) {
      var request = {
        id: 'k' + Date.now().toString(36) + (++keyRequests),
        rpId: rpId,
        challenge: toBase64Url(challenge),
        userVerification: String(publicKey.userVerification || 'preferred'),
        resolve: resolve,
        reject: reject,
        listed: false,
        timer: 0
      };
      // The web view's own request, for when Nebula has no passkeys to offer for this site.
      request.native = function () {
        if (pendingKey === request) pendingKey = null;
        window.clearTimeout(request.timer);
        originalGet.call(container, options).then(resolve, reject);
      };
      if (options.signal) {
        if (options.signal.aborted) {
          reject(domError('AbortError', 'The operation was aborted.'));
          return;
        }
        options.signal.addEventListener('abort', function () {
          window.clearTimeout(request.timer);
          failKeyRequest(request, 'AbortError', 'The operation was aborted.');
        });
      }
      if (pendingKey) {
        var previous = pendingKey;
        pendingKey = null;
        window.clearTimeout(previous.timer);
        previous.reject(domError('AbortError', 'A newer request replaced this one.'));
      }
      pendingKey = request;
      // No answer from Nebula in time: do it the way the web view does.
      request.timer = window.setTimeout(function () {
        if (pendingKey === request && !request.listed) request.native();
      }, 4000);
      post({
        type: 'nebula-passkeys',
        kind: 'list',
        requestId: request.id,
        rpId: rpId,
        origin: window.location.origin,
        url: window.location.href
      });
    });
  }

  function signWithPasskey(credentialId) {
    var request = pendingKey;
    if (!request) return;
    post({
      type: 'nebula-passkeys',
      kind: 'sign',
      requestId: request.id,
      rpId: request.rpId,
      credentialId: credentialId,
      challenge: request.challenge,
      userVerification: request.userVerification,
      origin: window.location.origin,
      url: window.location.href
    });
  }

  function makeCredential(data) {
    var rawId = fromBase64Url(data.credentialId);
    var buffer = function (text) {
      var bytes = fromBase64Url(text);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    var response = Object.create(window.AuthenticatorAssertionResponse.prototype);
    Object.defineProperties(response, {
      clientDataJSON: { value: buffer(data.clientDataJSON), enumerable: true },
      authenticatorData: { value: buffer(data.authenticatorData), enumerable: true },
      signature: { value: buffer(data.signature), enumerable: true },
      userHandle: { value: data.userHandle ? buffer(data.userHandle) : null, enumerable: true }
    });
    var credential = Object.create(window.PublicKeyCredential.prototype);
    Object.defineProperties(credential, {
      id: { value: data.credentialId, enumerable: true },
      rawId: { value: rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength), enumerable: true },
      type: { value: 'public-key', enumerable: true },
      authenticatorAttachment: { value: 'platform', enumerable: true },
      response: { value: response, enumerable: true },
      getClientExtensionResults: { value: function () { return {}; } },
      toJSON: {
        value: function () {
          return {
            id: data.credentialId,
            rawId: data.credentialId,
            type: 'public-key',
            authenticatorAttachment: 'platform',
            response: {
              clientDataJSON: data.clientDataJSON,
              authenticatorData: data.authenticatorData,
              signature: data.signature,
              userHandle: data.userHandle || undefined
            },
            clientExtensionResults: {}
          };
        }
      }
    });
    return credential;
  }

  // What the native side answers: the passkeys it found, or the result of a sign-in.
  function receivePasskeys(raw) {
    var data;
    try {
      data = JSON.parse(String(raw));
    } catch (_) {
      return 'invalid';
    }
    var request = pendingKey;
    if (!data || !request || data.requestId !== request.id) return 'ignored';
    if (data.kind === 'list') {
      var found = [];
      if (Array.isArray(data.passkeys)) {
        for (var i = 0; i < data.passkeys.length && found.length < 50; i++) {
          var item = data.passkeys[i];
          if (item && typeof item.id === 'string' && typeof item.name === 'string' && item.id) {
            found.push({ id: item.id.slice(0, 1400), name: item.name.slice(0, 320) });
          }
        }
      }
      if (found.length === 0) {
        request.native();
        return 'ok';
      }
      request.listed = true;
      window.clearTimeout(request.timer);
      passkeys = found;
      var focused = activeElement();
      if (focused && focused !== field) engage(focused);
      if (field && focused === field && !view.open && !quiet && typedText().trim() === '') dispatch('open');
      else dispatch('accounts');
      return 'ok';
    }
    if (data.kind === 'result') {
      if (data.ok === true) {
        var credential;
        try {
          credential = makeCredential(data);
        } catch (_) {
          failKeyRequest(request, 'NotAllowedError', 'The passkey could not be used.');
          return 'ok';
        }
        endKeyRequest();
        request.resolve(credential);
      } else {
        // The person cancelled or Windows refused: the list stays, so another choice is possible.
        passkeys = passkeys.slice();
        failKeyRequest(request, 'NotAllowedError', 'The operation either timed out or was not allowed.');
      }
      return 'ok';
    }
    return 'ignored';
  }

  (function installConditionalHook() {
    try {
      var container = window.CredentialsContainer && window.CredentialsContainer.prototype;
      var originalGet = container && container.get;
      if (typeof originalGet !== 'function' || !window.PublicKeyCredential || !window.AuthenticatorAssertionResponse) return;
      var wrapped = {
        get: function (options) {
          try {
            if (options && options.mediation === 'conditional' && options.publicKey) {
              return conditionalGet(options, originalGet, this);
            }
          } catch (_) {}
          return originalGet.apply(this, arguments);
        }
      }.get;
      Object.defineProperty(container, 'get', { value: wrapped, writable: false, configurable: false, enumerable: true });
    } catch (_) {}
  })();

  // ---- The bubble that offers to save or update a password ----
  //
  // Shown after a sign-in went through. It names the site and the account only (the password is never sent to the
  // page: it shows dots) and reports one of two answers, which the shell acts on with the login it kept itself.

  var bubble = null;

  function keyIcon() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', '7.5');
    ring.setAttribute('cy', '15.5');
    ring.setAttribute('r', '4');
    var shaft = document.createElementNS(ns, 'path');
    shaft.setAttribute('d', 'M10.5 12.5L20 3M16 7l3 3M13.5 9.5l2 2');
    svg.appendChild(ring);
    svg.appendChild(shaft);
    return svg;
  }

  function bubbleLine(label) {
    var line = document.createElement('div');
    line.className = 'line';
    var name = document.createElement('span');
    name.textContent = label;
    var value = document.createElement('b');
    line.appendChild(name);
    line.appendChild(value);
    return { line: line, name: name, value: value };
  }

  function ensureBubble() {
    if (bubble) return bubble;
    var host = document.createElement('div');
    var root = attachShadowOf.call(host, { mode: 'closed' });
    applyTheme(host);
    var css = [
      ':host { all: initial; }',
      '.card { position: fixed; z-index: 2147483647; top: 16px; right: 16px; box-sizing: border-box; display: none;',
      '  width: min(340px, calc(100vw - 32px)); padding: 14px 16px 16px; border-radius: 14px; border: 1px solid var(--nb-border, #d6d8e0);',
      '  background: var(--nb-card, #ffffff); color: var(--nb-text, #1b1d27); box-shadow: var(--nb-shadow, 0 14px 36px rgba(15, 18, 32, 0.26));',
      '  font: 13px/1.4 system-ui, "Segoe UI", sans-serif; animation: enter 160ms ease-out; }',
      '@keyframes enter { from { opacity: 0; transform: translateY(-6px); } }',
      '.head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }',
      '.badge { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--nb-soft, #e0e3ff); color: var(--nb-ink, #4338ca); }',
      '.title { flex: 1; min-width: 0; font-size: 14px; font-weight: 650; }',
      '.close { flex: none; width: 24px; height: 24px; border: 0; border-radius: 6px; background: none; color: inherit; opacity: .6; font-size: 18px; line-height: 1; cursor: pointer; }',
      '.close:hover { opacity: 1; background: var(--nb-surface, rgba(120, 124, 150, .18)); }',
      '.line { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }',
      '.line span { color: var(--nb-muted, #6b6f82); }',
      '.line b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }',
      '.actions { display: flex; gap: 8px; margin-top: 14px; }',
      '.actions button { flex: 1; height: 34px; border-radius: 9px; font: inherit; font-weight: 600; cursor: pointer; }',
      '.primary { border: 0; background: linear-gradient(135deg, var(--nb-strong, #4338ca), var(--nb-accent, #4f46e5)); color: var(--nb-on, #ffffff); }',
      '.primary:hover { filter: brightness(1.08); }',
      '.ghost { border: 1px solid var(--nb-field, #d6d8e0); background: var(--nb-surface, none); color: inherit; }',
      '.ghost:hover { background: var(--nb-soft, rgba(120, 124, 150, .14)); }',
      // Without colours from the shell, the page's own dark preference decides.
      '@media (prefers-color-scheme: dark) {',
      '  :host(:not([data-themed])) .card { background: #1f2130; color: #eceefa; border-color: #3a3d54; box-shadow: 0 14px 36px rgba(0, 0, 0, 0.55); }',
      '  :host(:not([data-themed])) .badge { background: #34376a; color: #c7c9ff; } :host(:not([data-themed])) .line span { color: #9a9eb8; }',
      '  :host(:not([data-themed])) .primary { background: #6366f1; } :host(:not([data-themed])) .ghost { border-color: #3a3d54; }',
      '}'
    ].join('\n');
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } catch (_) {
      var style = document.createElement('style');
      style.textContent = css;
      root.appendChild(style);
    }
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');
    var head = document.createElement('div');
    head.className = 'head';
    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.appendChild(keyIcon());
    var title = document.createElement('span');
    title.className = 'title';
    var close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '×';
    head.appendChild(badge);
    head.appendChild(title);
    head.appendChild(close);
    var site = bubbleLine('');
    var account = bubbleLine('');
    var secret = bubbleLine('');
    secret.value.textContent = '••••••••';
    var actions = document.createElement('div');
    actions.className = 'actions';
    var primary = document.createElement('button');
    primary.className = 'primary';
    primary.type = 'button';
    var ghost = document.createElement('button');
    ghost.className = 'ghost';
    ghost.type = 'button';
    actions.appendChild(primary);
    actions.appendChild(ghost);
    card.appendChild(head);
    card.appendChild(site.line);
    card.appendChild(account.line);
    card.appendChild(secret.line);
    card.appendChild(actions);
    root.appendChild(card);
    card.addEventListener('mousedown', function (event) {
      event.preventDefault();
    });
    primary.addEventListener('click', function (event) {
      if (event.isTrusted) answerBubble('save');
    });
    ghost.addEventListener('click', function (event) {
      if (event.isTrusted) answerBubble('dismiss');
    });
    close.addEventListener('click', function (event) {
      if (event.isTrusted) answerBubble('dismiss');
    });
    bubble = {
      host: host, card: card, title: title, site: site, account: account, secret: secret,
      primary: primary, ghost: ghost, close: close
    };
    return bubble;
  }

  function hideBubble() {
    if (bubble) bubble.card.style.display = 'none';
  }

  function answerBubble(kind) {
    hideBubble();
    post({
      type: 'nebula-password-suggest',
      kind: kind,
      origin: window.location.origin,
      url: window.location.href,
      username: ''
    });
  }

  function text(value, limit) {
    return typeof value === 'string' ? value.slice(0, limit) : '';
  }

  // The shell asks for the bubble ({ hide: true } takes it away again).
  function receiveBubble(raw) {
    var data;
    try {
      data = JSON.parse(String(raw));
    } catch (_) {
      return 'invalid';
    }
    if (!data || data.hide === true) {
      hideBubble();
      return 'ok';
    }
    var labels = data.labels || {};
    if (data.theme) setTheme(data.theme);
    var parts = ensureBubble();
    parts.title.textContent = text(labels.title, 120);
    parts.site.name.textContent = text(labels.site, 40);
    parts.site.value.textContent = text(data.site, 253);
    parts.account.name.textContent = text(labels.account, 40);
    parts.account.value.textContent = text(data.username, 320);
    parts.secret.name.textContent = text(labels.password, 40);
    parts.primary.textContent = text(labels.save, 40);
    parts.ghost.textContent = text(labels.dismiss, 40);
    parts.close.setAttribute('aria-label', text(labels.dismiss, 40));
    if (!parts.host.isConnected) (document.documentElement || document).appendChild(parts.host);
    parts.card.style.display = 'block';
    return 'ok';
  }

  function define(name, value) {
    try {
      Object.defineProperty(window, name, {
        value: value,
        writable: false,
        configurable: false,
        enumerable: false
      });
    } catch (_) {}
  }

  define('__nebulaPasswordSuggest', receive);
  define('__nebulaPasswordSave', receiveBubble);
  define('__nebulaPasskeys', receivePasskeys);
})();
