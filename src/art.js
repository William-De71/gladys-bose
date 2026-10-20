// -----------------------------------------------------------------------------
// Cover art of what is playing, for the widget.
//
// The speaker gives the URL of the cover chosen by the music service (an
// https address of Spotify, Deezer, TuneIn…). Gladys never loads a
// third-party URL itself: the integration downloads the image and serves it
// under a key. The core accepts PNG, JPEG or WebP of at most 300 KB and
// never resizes: a bigger cover is simply not shown (no image library in
// the container).
//
// The key is a hash of the bytes (Gladys caches an image an hour by key).
// The last 20 covers stay in memory.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const MAX_BYTES = 300 * 1024;
const TIMEOUT_MS = 6000;
const KEEP = 20;
const RETRY_FAILED_MS = 10 * 60 * 1000;

/**
 * @description Is it a PNG, a JPEG or a WebP image?
 * @param {Buffer} bytes - Content.
 * @returns {boolean} One of the three.
 */
export function isImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) {
    return false;
  }
  return (
    bytes.subarray(0, 4).toString('hex') === '89504e47' ||
    bytes.subarray(0, 3).toString('hex') === 'ffd8ff' ||
    (bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
      bytes.subarray(8, 12).toString('latin1') === 'WEBP')
  );
}

/**
 * @description Create the cover store.
 * @param {object} [deps] - Dependencies.
 * @param {Function} [deps.fetch] - fetch (tests: a fake one).
 * @param {Function} [deps.now] - Clock (ms).
 * @returns {{ keyFor: Function, image: Function }} The store.
 */
export function createArtStore({ fetch = globalThis.fetch, now = Date.now } = {}) {
  const byUrl = new Map(); // url -> { key, at } (key null: failed)
  const images = new Map(); // key -> base64
  const loading = new Map();

  const remember = (url, key, base64) => {
    byUrl.delete(url);
    byUrl.set(url, { key, at: now() });
    if (key) {
      images.delete(key);
      images.set(key, base64);
    }
    while (byUrl.size > KEEP) {
      byUrl.delete(byUrl.keys().next().value);
    }
    while (images.size > KEEP) {
      images.delete(images.keys().next().value);
    }
  };

  const download = async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const length = Number(response.headers.get('content-length') ?? 0);
      if (!response.ok || length > MAX_BYTES) {
        return null;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES || !isImage(bytes)) {
        return null;
      }
      return bytes;
    } catch {
      return null;
    }
  };

  return {
    /**
     * @description The image key of a cover, downloading it the first time.
     * @param {string} url - Cover URL (https only).
     * @returns {Promise<string|undefined>} The key, undefined when there is no usable image.
     */
    async keyFor(url) {
      if (!/^https:\/\//i.test(String(url ?? ''))) {
        return undefined;
      }
      const known = byUrl.get(url);
      if (known && (known.key || now() - known.at < RETRY_FAILED_MS)) {
        return known.key ?? undefined;
      }
      if (!loading.has(url)) {
        loading.set(
          url,
          download(url)
            .then((bytes) => {
              const key = bytes
                ? `art-${createHash('sha1').update(bytes).digest('hex').slice(0, 20)}`
                : null;
              remember(url, key, bytes?.toString('base64'));
              return key ?? undefined;
            })
            .finally(() => loading.delete(url)),
        );
      }
      return loading.get(url);
    },

    /**
     * @param {string} key - Image key.
     * @returns {string} Raw base64, '' when unknown.
     */
    image: (key) => images.get(key) ?? '',
  };
}
