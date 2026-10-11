// Nebula extension compatibility shim. It runs first in an extension's service
// worker (see extension_compat.rs) and changes nothing else about the extension.
//
// WebView2 has no browser UI, so a window Nebula opens for an extension's popup or
// side panel is reported to the worker as a browser tab: `sender.tab` is set for
// every frame inside it. Chrome sets no `tab` for those. Extensions use "no
// sender.tab" to tell their own UI from a web page, so they misjudge the panel.
//
// For senders that are frames of THIS extension's own pages, hand the listener the
// shape Chrome gives it (no `tab`). Content scripts and frames of real web tabs
// keep their `tab`. Without the `tabs` permission `tab.url` is hidden, the sender
// cannot be recognised, and it is left exactly as it arrived.
(() => {
  'use strict';
  try {
    const runtime = self.chrome && self.chrome.runtime;
    if (!runtime || !runtime.id || self.__nebulaCompat) return;
    Object.defineProperty(self, '__nebulaCompat', { value: true });

    const own = 'chrome-extension://' + runtime.id + '/';
    const hosted = (sender) => {
      const tab = sender && sender.tab;
      return !!tab && typeof tab.url === 'string' && tab.url.startsWith(own);
    };
    const withoutTab = (sender) => {
      if (!hosted(sender)) return sender;
      const copy = Object.assign({}, sender);
      delete copy.tab;
      return copy;
    };
    const withoutTabPort = (port) =>
      new Proxy(port, {
        get(target, key) {
          if (key === 'sender') return withoutTab(target.sender);
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

    const adaptMessage = (listener) => (message, sender, sendResponse) =>
      listener.call(undefined, message, withoutTab(sender), sendResponse);
    const adaptConnect = (listener) => (port) =>
      listener.call(undefined, hosted(port && port.sender) ? withoutTabPort(port) : port);

    const override = (event, name, value) => {
      try {
        event[name] = value;
        if (event[name] === value) return;
      } catch (_) { /* fall through to defineProperty */ }
      Object.defineProperty(event, name, { value, configurable: true, writable: true });
    };
    const wrapEvent = (event, adapt) => {
      if (!event || typeof event.addListener !== 'function') return;
      const add = event.addListener.bind(event);
      const remove = event.removeListener.bind(event);
      const has = event.hasListener.bind(event);
      const wrappers = new WeakMap();
      override(event, 'addListener', (listener, ...rest) => {
        if (typeof listener !== 'function') return add(listener, ...rest);
        let wrapper = wrappers.get(listener);
        if (!wrapper) {
          wrapper = adapt(listener);
          wrappers.set(listener, wrapper);
        }
        return add(wrapper, ...rest);
      });
      override(event, 'removeListener', (listener, ...rest) => remove(wrappers.get(listener) || listener, ...rest));
      override(event, 'hasListener', (listener) => has(wrappers.get(listener) || listener));
    };

    wrapEvent(runtime.onMessage, adaptMessage);
    wrapEvent(runtime.onMessageExternal, adaptMessage);
    wrapEvent(runtime.onConnect, adaptConnect);
    wrapEvent(runtime.onConnectExternal, adaptConnect);
  } catch (_) {
    // Never keep the extension from starting.
  }
})();
