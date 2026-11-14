// Nebula's protection against browser fingerprinting. Put in every frame of a page before its own scripts run (see
// src-tauri/src/fingerprint.rs, which puts in the number below, the same for one site for as long as the app runs and
// different for every other site).
//
// A fingerprint is made of small differences between computers that a script can read: how a canvas is rasterised, how an audio
// graph sums, how many cores there are. Making the reading slightly different for each site, and the same every time for one site,
// keeps each site's view of the machine stable (so nothing that relies on it breaks) and stops two sites from recognising the same
// machine by it. The change is far below what an eye or an ear can tell: the low bit of a few colour values, a few millionths of a
// sample. A canvas that was blank stays blank. The page's own canvas is never changed, only what is read back from it.
//
// What this does not do: workers (their globals are not reached from here), fonts, the screen and the time zone.
(function () {
  'use strict';
  const SEED = __SEED__ >>> 0;

  // Once for a window: a script registered twice (two navigations that started before the first registration finished) would
  // otherwise wrap what it had already wrapped, and the noise would be put in twice.
  const done = Symbol.for('nebula.fingerprint');
  if (window[done]) return;
  Object.defineProperty(window, done, { value: true });

  // Challenges that decide whether someone is a person (and fail them if the machine looks odd) are left as they are.
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  const is = (name) => host === name || host.endsWith('.' + name);
  if (
    is('challenges.cloudflare.com') ||
    is('hcaptcha.com') ||
    is('recaptcha.net') ||
    is('arkoselabs.com') ||
    is('funcaptcha.com') ||
    is('captcha-delivery.com') ||
    ((is('google.com') || is('gstatic.com')) && path.includes('/recaptcha'))
  ) {
    return;
  }

  // ---- the numbers: a generator that gives the same sequence for the same seed.
  function generator(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(a, b) {
    return (Math.imul(a ^ (b + 0x9e3779b9), 0x85ebca6b) ^ (a >>> 13)) >>> 0;
  }

  // ---- being invisible: a patched function reads as the native one it replaced.
  const nativeToString = Function.prototype.toString;
  const looksNative = new WeakMap();
  const toStringReplacement = {
    toString() {
      return looksNative.has(this) ? looksNative.get(this) : nativeToString.call(this);
    },
  }.toString;
  looksNative.set(toStringReplacement, nativeToString.call(nativeToString));
  Object.defineProperty(Function.prototype, 'toString', { value: toStringReplacement, writable: true, configurable: true });

  /** Replaces `object[name]` with `make(original)`, keeping what a script can see of the property: its name, length and text. */
  function patch(object, name, make) {
    if (!object) return;
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value;
    const replacement = make(original);
    Object.defineProperty(replacement, 'name', { value: original.name, configurable: true });
    Object.defineProperty(replacement, 'length', { value: original.length, configurable: true });
    looksNative.set(replacement, nativeToString.call(original));
    Object.defineProperty(object, name, { ...descriptor, value: replacement });
  }

  // ---- pixels: a few colour values of a few pixels move by one. Transparent pixels never move, so an empty canvas stays empty.
  function noisyPixels(data, salt) {
    const next = generator(mix(SEED, salt));
    let i = Math.floor(next() * 96) * 4;
    while (i < data.length) {
      if (data[i + 3] !== 0) {
        const channel = Math.floor(next() * 3);
        const value = data[i + channel];
        data[i + channel] = value === 255 ? 254 : value === 0 ? 1 : next() < 0.5 ? value - 1 : value + 1;
      }
      i += (1 + Math.floor(next() * 96)) * 4;
    }
  }

  const CanvasProto = typeof HTMLCanvasElement === 'undefined' ? null : HTMLCanvasElement.prototype;
  const Context2DProto = typeof CanvasRenderingContext2D === 'undefined' ? null : CanvasRenderingContext2D.prototype;
  const originalGetImageData = Context2DProto ? Context2DProto.getImageData : null;

  /** A copy of the canvas with the noise in it, or null when there is nothing to do or it cannot be read (then the original runs and
   *  fails the way it always does). Tiny canvases are left alone: no fingerprint fits in them. */
  function noisyCopy(canvas) {
    try {
      const width = canvas.width;
      const height = canvas.height;
      if (!originalGetImageData || width * height < 256) return null;
      const copy = document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      const context = copy.getContext('2d', { willReadFrequently: true });
      context.drawImage(canvas, 0, 0);
      const image = originalGetImageData.call(context, 0, 0, width, height);
      noisyPixels(image.data, mix(width, height));
      context.putImageData(image, 0, 0);
      return copy;
    } catch (_) {
      return null;
    }
  }

  if (CanvasProto) {
    patch(CanvasProto, 'toDataURL', (original) =>
      function toDataURL() {
        const copy = noisyCopy(this);
        return original.apply(copy || this, arguments);
      });
    patch(CanvasProto, 'toBlob', (original) =>
      function toBlob() {
        const copy = noisyCopy(this);
        return original.apply(copy || this, arguments);
      });
  }
  if (Context2DProto) {
    patch(Context2DProto, 'getImageData', (original) =>
      function getImageData() {
        const image = original.apply(this, arguments);
        if (image && image.data && image.data.length >= 1024) noisyPixels(image.data, mix(image.width, image.height));
        return image;
      });
  }
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    patch(OffscreenCanvasRenderingContext2D.prototype, 'getImageData', (original) =>
      function getImageData() {
        const image = original.apply(this, arguments);
        if (image && image.data && image.data.length >= 1024) noisyPixels(image.data, mix(image.width, image.height));
        return image;
      });
  }

  // ---- WebGL: what readPixels writes into an 8-bit RGBA array.
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const proto = typeof window[name] === 'undefined' ? null : window[name].prototype;
    patch(proto, 'readPixels', (original) =>
      function readPixels() {
        const result = original.apply(this, arguments);
        const target = arguments[6];
        if (target instanceof Uint8Array && target.length >= 1024 && arguments[4] === 0x1908 /* RGBA */) {
          noisyPixels(target, mix(arguments[2] | 0, arguments[3] | 0));
        }
        return result;
      });
  }

  // ---- audio: a few millionths of a sample, once for each buffer, and in what an analyser reports.
  const noisedBuffers = new WeakSet();
  function noisySamples(samples, salt) {
    const next = generator(mix(SEED, salt));
    let i = Math.floor(next() * 8);
    while (i < samples.length) {
      samples[i] += (next() - 0.5) * 2e-7;
      i += 1 + Math.floor(next() * 8);
    }
  }
  if (typeof AudioBuffer !== 'undefined') {
    patch(AudioBuffer.prototype, 'getChannelData', (original) =>
      function getChannelData() {
        const samples = original.apply(this, arguments);
        if (samples && samples.length >= 64 && !noisedBuffers.has(samples.buffer)) {
          noisedBuffers.add(samples.buffer);
          noisySamples(samples, mix(samples.length, arguments[0] | 0));
        }
        return samples;
      });
  }
  if (typeof AnalyserNode !== 'undefined') {
    for (const name of ['getFloatFrequencyData', 'getFloatTimeDomainData']) {
      patch(AnalyserNode.prototype, name, (original) =>
        function () {
          const result = original.apply(this, arguments);
          const array = arguments[0];
          if (array instanceof Float32Array && array.length >= 16) noisySamples(array, mix(array.length, 7));
          return result;
        });
    }
  }

  // ---- cores: a machine with many reports eight, which is what most have anyway.
  if (typeof Navigator !== 'undefined') {
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
    if (descriptor && typeof descriptor.get === 'function') {
      const originalGetter = descriptor.get;
      const getter = {
        get hardwareConcurrency() {
          const real = originalGetter.call(this);
          return typeof real === 'number' ? Math.min(real, 8) : real;
        },
      };
      const replacement = Object.getOwnPropertyDescriptor(getter, 'hardwareConcurrency').get;
      Object.defineProperty(replacement, 'name', { value: originalGetter.name, configurable: true });
      looksNative.set(replacement, nativeToString.call(originalGetter));
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { ...descriptor, get: replacement });
    }
  }
})();
