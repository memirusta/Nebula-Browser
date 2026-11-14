// The part of a page that runs the hiding rules that need the page to be looked at (:has-text, :upward, :xpath, :matches-css ...).
//
// A plain selector is made into a style rule by the shield (the browser does the work). A rule with an operator that CSS does not have
// is given to this function as data: a list of {"selector": [{"type", "arg"}, ...], "action": {"type", "arg"}} as the engine
// (adblock) reads them from the lists. The selector is a chain: the first part (a CSS selector, or an XPath) gives the elements to start
// from, and each part after it keeps some of them (:has-text), moves to others (:upward, :xpath, a selector below them) or says whether
// the rule holds on this page at all (:matches-path). What is left is hidden (or removed, or has a style given), now and whenever the
// page changes.
//
// It never touches the page itself (html, body, anything that holds the body), and it slows down on a page that changes all the time.
(function (filters) {
  'use strict';
  if (!Array.isArray(filters) || filters.length === 0) { return; }

  // A matcher for a plain text (is in) or for /regex/flags.
  const matcherOf = (text) => {
    const parts = /^\/(.+)\/([a-z]*)$/.exec(text);
    if (parts) {
      try {
        const re = new RegExp(parts[1], parts[2].replace(/[^imsu]/g, ''));
        return (value) => re.test(value);
      } catch (e) {
        return () => false;
      }
    }
    return (value) => value.includes(text);
  };
  const exactOf = (text) => {
    const parts = /^\/(.+)\/([a-z]*)$/.exec(text);
    return parts ? matcherOf(text) : (value) => value === text;
  };
  const unquote = (text) => {
    const trimmed = text.trim();
    return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  };
  const unique = (elements) => Array.from(new Set(elements));

  // An operator becomes a function from the elements so far to the elements that remain (or are moved to).
  const operatorOf = (op, position) => {
    const arg = op.arg === undefined || op.arg === null ? '' : String(op.arg);
    switch (op.type) {
      case 'css-selector':
        if (position === 0) {
          return () => Array.from(document.querySelectorAll(arg));
        }
        // After another operator a selector is about what is below the elements (it may begin with > + ~).
        return (elements) => unique(elements.flatMap((element) => Array.from(element.querySelectorAll(':scope ' + arg))));
      case 'has-text': {
        const matches = matcherOf(arg);
        return (elements) => elements.filter((element) => matches(element.textContent || ''));
      }
      case 'min-text-length': {
        const least = Number(arg) || 0;
        return (elements) => elements.filter((element) => (element.textContent || '').length >= least);
      }
      case 'matches-css':
      case 'matches-css-before':
      case 'matches-css-after': {
        const pseudo = op.type === 'matches-css-before' ? '::before' : op.type === 'matches-css-after' ? '::after' : null;
        const colon = arg.indexOf(':');
        if (colon < 1) { return () => []; }
        const property = arg.slice(0, colon).trim();
        const matches = matcherOf(unquote(arg.slice(colon + 1)));
        return (elements) => elements.filter((element) => matches(getComputedStyle(element, pseudo).getPropertyValue(property)));
      }
      case 'matches-attr': {
        const equals = arg.indexOf('=');
        const name = exactOf(unquote(equals < 0 ? arg : arg.slice(0, equals)));
        const value = equals < 0 ? null : exactOf(unquote(arg.slice(equals + 1)));
        return (elements) => elements.filter((element) => Array.from(element.attributes).some((attribute) => name(attribute.name) && (value === null || value(attribute.value))));
      }
      case 'matches-path': {
        const matches = matcherOf(arg);
        // Not about the elements: whether the rule is for this page.
        return (elements) => (matches(location.pathname + location.search + location.hash) ? elements : []);
      }
      case 'upward':
        if (/^\d+$/.test(arg)) {
          const steps = Number(arg);
          return (elements) => unique(elements.map((element) => {
            let current = element;
            for (let step = 0; step < steps && current; step += 1) { current = current.parentElement; }
            return current;
          }).filter(Boolean));
        }
        return (elements) => unique(elements.map((element) => (element.parentElement ? element.parentElement.closest(arg) : null)).filter(Boolean));
      case 'xpath':
        return (elements) => {
          const found = [];
          for (const start of position === 0 ? [document] : elements) {
            const snapshot = document.evaluate(arg, start, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let index = 0; index < snapshot.snapshotLength; index += 1) {
              const node = snapshot.snapshotItem(index);
              if (node && node.nodeType === 1) { found.push(node); }
            }
          }
          return unique(found);
        };
      default:
        return null;
    }
  };

  const protectedElement = (element) => {
    const root = document.documentElement;
    const body = document.body;
    return element === root || element === body || element === document.head || (body && element.contains(body));
  };

  const actionOf = (action) => {
    if (!action) {
      return (element) => { element.style.setProperty('display', 'none', 'important'); };
    }
    const arg = action.arg === undefined || action.arg === null ? '' : String(action.arg);
    switch (action.type) {
      case 'remove':
        return (element) => { element.remove(); };
      case 'style':
        return (element) => {
          for (const declaration of arg.split(';')) {
            const colon = declaration.indexOf(':');
            if (colon < 1) { continue; }
            const value = declaration.slice(colon + 1).trim();
            const important = /!\s*important\s*$/i.test(value);
            element.style.setProperty(declaration.slice(0, colon).trim(), value.replace(/!\s*important\s*$/i, '').trim(), important ? 'important' : '');
          }
        };
      case 'remove-attr':
        return (element) => { element.removeAttribute(arg); };
      case 'remove-class':
        return (element) => { element.classList.remove(arg); };
      default:
        return null;
    }
  };

  // A filter that cannot be made into steps is left out, and so is one that would start from the whole page: it could only ever
  // match what it was not meant for.
  const compiled = [];
  for (const filter of filters.slice(0, 400)) {
    try {
      const chain = filter.selector;
      if (!Array.isArray(chain) || chain.length === 0) { continue; }
      if (chain[0].type !== 'css-selector' && chain[0].type !== 'xpath') { continue; }
      const steps = chain.map(operatorOf);
      const act = actionOf(filter.action);
      if (steps.some((step) => step === null) || act === null) { continue; }
      // What a rule has acted on is remembered for that rule only: two rules may act on the same element (remove a class, then an attribute).
      compiled.push({ steps, act, done: new WeakSet() });
    } catch (e) {
      // A rule the browser does not understand is only that rule.
    }
  }
  if (compiled.length === 0) { return; }

  const apply = () => {
    for (const { steps, act, done } of compiled) {
      try {
        let elements = [];
        for (const step of steps) {
          elements = step(elements);
          if (elements.length === 0) { break; }
        }
        for (const element of elements) {
          if (done.has(element) || protectedElement(element)) { continue; }
          done.add(element);
          act(element);
        }
      } catch (e) {
        // One rule going wrong does not stop the others.
      }
    }
  };

  // Now, and after the page changes: not on every change (a page that loads advertisements changes all the time), and the busier
  // the page, the longer between two looks.
  let delay = 150;
  let waiting = false;
  const schedule = () => {
    if (waiting) { return; }
    waiting = true;
    setTimeout(() => {
      waiting = false;
      const began = performance.now();
      apply();
      const took = performance.now() - began;
      delay = took > 25 ? Math.min(2000, delay * 2) : Math.max(150, delay / 2);
    }, delay);
  };
  const start = () => {
    apply();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  };
  const whenThere = () => {
    if (document.documentElement) { start(); return; }
    const watch = new MutationObserver(() => {
      if (document.documentElement) { watch.disconnect(); start(); }
    });
    watch.observe(document, { childList: true });
  };
  whenThere();
  document.addEventListener('DOMContentLoaded', apply, { once: true });
})
