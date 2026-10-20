// -----------------------------------------------------------------------------
// The speakers and their connections.
//
//   - a speaker the user created in Gladys stays connected: its changes are
//     pushed over the WebSocket (subscription), nothing is polled but a light
//     liveness check every minute (power state) and the battery of the
//     portable ones every five minutes;
//   - a speaker only discovered is connected for the scan, read, then
//     disconnected (a speaker accepts a limited number of clients);
//   - a lost connection is retried 10 s, 30 s, 1 min, 2 min, then every
//     5 min; after two failures the app searches the network again (DHCP
//     may have given the speaker another address, its GUID stays).
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { BoseError, openConnection } from './bose/connection.js';
import {
  AUDIO_SETTINGS,
  parseAudioMode,
  parseAudioSetting,
  parseBattery,
  parseCapabilities,
  parseGroup,
  parseNowPlaying,
  parsePower,
  parsePresets,
  parseSources,
  parseSystemInfo,
  parseVolume,
} from './bose/model.js';

const MINUTE = 60 * 1000;
const HEARTBEAT_MS = MINUTE;
const BATTERY_MS = 5 * MINUTE;
const RETRY_MS = [10000, 30000, MINUTE, 2 * MINUTE, 5 * MINUTE];
const PROBE_TIMEOUT_MS = 5000;

// What the speaker pushes once subscribed: only the resources used here.
export const SUBSCRIBED = [
  '/system/power/control',
  '/audio/volume',
  '/content/nowPlaying',
  '/system/sources',
  '/system/productSettings',
  '/system/info',
  '/system/battery',
  '/grouping/activeGroups',
  '/audio/mode',
  ...Object.values(AUDIO_SETTINGS),
];

const SETTING_BY_RESOURCE = Object.fromEntries(
  Object.entries(AUDIO_SETTINGS).map(([key, resource]) => [resource, key]),
);

/**
 * @description Create the hub.
 * @param {object} deps - Dependencies.
 * @param {object} deps.account - src/account.js account.
 * @param {Function} [deps.connect] - openConnection (tests: plain ws to a fake speaker).
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.onUpdate] - `(entry, what) => void`: state changed (`what`: a resource, `connection`).
 * @param {Function} [deps.onRescan] - `() => void`: a speaker could not be found where it was.
 * @param {number} [deps.probeTimeoutMs] - Wait for a sound setting a speaker may not have.
 * @param {number[]} [deps.retryMs] - Delays between reconnection attempts.
 * @returns {object} The hub.
 */
export function createHub({
  account,
  connect = openConnection,
  logger = sdkLogger,
  onUpdate = () => {},
  onRescan = () => {},
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  retryMs = RETRY_MS,
}) {
  const entries = new Map(); // guid -> entry
  const keep = new Set(); // guids to keep connected
  let stopped = false;
  let heartbeatTimer = null;
  let batteryTimer = null;

  const newEntry = (guid, host) => ({
    guid,
    host,
    mdnsName: '',
    info: null,
    caps: new Set(),
    conn: null,
    connecting: null,
    reachable: null,
    failures: 0,
    retryTimer: null,
    on: null,
    volume: null,
    muted: null,
    nowPlaying: null,
    sources: null,
    presets: [],
    audio: {},
    mode: null,
    battery: null,
    group: null,
    groupKnown: false,
    // Sound settings that did not answer once: not asked again in this run.
    missing: new Set(),
  });

  /** Apply what the speaker says about a resource; true when it was one of ours. */
  const apply = (entry, resource, body) => {
    switch (resource) {
      case '/system/power/control': {
        const on = parsePower(body);
        if (on === null) {
          return false;
        }
        entry.on = on;
        break;
      }
      case '/audio/volume': {
        const { level, muted } = parseVolume(body);
        entry.volume = level ?? entry.volume;
        entry.muted = muted ?? entry.muted;
        break;
      }
      case '/content/nowPlaying':
        entry.nowPlaying = parseNowPlaying(body);
        break;
      case '/system/sources':
        entry.sources = parseSources(body);
        break;
      case '/system/productSettings':
        entry.presets = parsePresets(body);
        break;
      case '/system/info':
        entry.info = { ...entry.info, ...parseSystemInfo(body) };
        break;
      case '/system/battery':
        entry.battery = parseBattery(body);
        break;
      case '/grouping/activeGroups':
        entry.group = parseGroup(body);
        entry.groupKnown = true;
        break;
      case '/audio/mode': {
        const mode = parseAudioMode(body);
        if (!mode) {
          return false;
        }
        // A command answer may carry the value without the list of modes.
        entry.mode = {
          value: mode.value || entry.mode?.value || '',
          options: mode.options.length > 0 ? mode.options : (entry.mode?.options ?? []),
        };
        break;
      }
      default: {
        const key = SETTING_BY_RESOURCE[resource];
        if (!key) {
          return false;
        }
        const setting = parseAudioSetting(body);
        if (!setting) {
          return false;
        }
        // The range is fixed once known: the Discover "Update" compares the options.
        const known = entry.audio[key];
        entry.audio[key] = known ? { ...known, value: setting.value } : setting;
      }
    }
    return true;
  };

  const notify = (entry, what) => {
    try {
      onUpdate(entry, what);
    } catch (error) {
      logger.warn(`Bose: update handler failed: ${error.message}`);
    }
  };

  const setReachable = (entry, reachable) => {
    if (entry.reachable !== reachable) {
      entry.reachable = reachable;
      notify(entry, 'connection');
    }
  };

  const read = async (entry, resource, timeoutMs) => {
    const body = timeoutMs
      ? await Promise.race([
          entry.conn.request(resource),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new BoseError('probe timeout', { kind: 'timeout' })),
              timeoutMs,
            ).unref?.(),
          ),
        ])
      : await entry.conn.request(resource);
    apply(entry, resource, body);
    return body;
  };

  const tryRead = (entry, resource, timeoutMs) =>
    read(entry, resource, timeoutMs).catch((error) => {
      logger.debug?.(`Bose: ${entry.host} ${resource}: ${error.message}`);
      return null;
    });

  /** Everything the integration shows, read once after connecting. */
  const readAll = async (entry) => {
    const has = (resource) => entry.caps.has(resource);
    await Promise.all([
      tryRead(entry, '/system/power/control'),
      tryRead(entry, '/audio/volume'),
      tryRead(entry, '/content/nowPlaying'),
      tryRead(entry, '/system/sources'),
      tryRead(entry, '/system/productSettings'),
      has('/audio/mode') ? tryRead(entry, '/audio/mode') : null,
      has('/system/battery') ? tryRead(entry, '/system/battery') : null,
      has('/grouping/activeGroups') ? tryRead(entry, '/grouping/activeGroups') : null,
      // Speakers do not always list every sound setting they have: the
      // missing ones are asked too, with a short timeout (a speaker stays
      // silent about what it does not have).
      ...Object.values(AUDIO_SETTINGS)
        .filter((resource) => has(resource) || !entry.missing.has(resource))
        .map(async (resource) => {
          const body = await tryRead(entry, resource, has(resource) ? undefined : probeTimeoutMs);
          if (!body && !has(resource)) {
            entry.missing.add(resource);
          }
        }),
    ]);
  };

  const scheduleRetry = (entry) => {
    clearTimeout(entry.retryTimer);
    if (stopped || !keep.has(entry.guid)) {
      return;
    }
    const delay = retryMs[Math.min(Math.max(entry.failures - 1, 0), retryMs.length - 1)];
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      hub.connect(entry).catch(() => {});
    }, delay);
    entry.retryTimer.unref?.();
    if (entry.failures === 2) {
      onRescan();
    }
  };

  const lost = (entry, error) => {
    entry.conn = null;
    if (stopped) {
      return;
    }
    entry.failures += 1;
    logger.info(`Bose: ${entry.info?.name || entry.host} unreachable (${error?.message ?? error})`);
    setReachable(entry, false);
    scheduleRetry(entry);
  };

  const connectOnce = async (entry) => {
    let conn;
    try {
      conn = await connect({
        host: entry.host,
        // Only the GUID exactly as the speaker writes it (it reads it from its
        // first message otherwise): the mDNS one is normalized.
        guid: entry.reportedGuid ?? '',
        getToken: () => account.token(),
        onNotify: (resource, body) => {
          if (entry.conn === conn && apply(entry, resource, body)) {
            notify(entry, resource);
          }
        },
        onClose: (error) => {
          if (entry.conn === conn) {
            lost(entry, error);
          }
        },
      });
      entry.conn = conn;
      const guid = await conn.waitForGuid();
      entry.reportedGuid = String(guid);
      entry.caps = parseCapabilities(await conn.request('/system/capabilities'));
      entry.info = { ...entry.info, ...parseSystemInfo(await conn.request('/system/info')) };
      try {
        await conn.request(
          '/subscription',
          'PUT',
          { notifications: SUBSCRIBED.map((resource) => ({ resource, version: 1 })) },
          { version: 2 },
        );
      } catch (error) {
        logger.warn(`Bose: ${entry.host} refused the subscription: ${error.message}`);
      }
      await readAll(entry);
      if (!conn.isOpen() || entry.conn !== conn) {
        // Lost (or replaced) while reading: not a working connection.
        throw new BoseError(`connection to ${entry.host} lost while reading`, { kind: 'closed' });
      }
      entry.ready = true;
      entry.failures = 0;
      setReachable(entry, true);
      notify(entry, 'all');
      return entry;
    } catch (error) {
      if (conn) {
        conn.close();
      }
      if (entry.conn === conn) {
        entry.conn = null;
      }
      if (error?.status === 401 && !/not before/i.test(error.message ?? '')) {
        // The speaker refused the token: renew it for the next attempt.
        account.renew().catch(() => {});
      }
      throw error;
    }
  };

  const hub = {
    entries,

    /** The entry of a GUID, created with this address when new. */
    entryOf(guid, host) {
      let entry = entries.get(guid);
      if (!entry) {
        entry = newEntry(guid, host);
        entries.set(guid, entry);
      } else if (host && host !== entry.host) {
        logger.info(`Bose: ${entry.info?.name || guid} moved from ${entry.host} to ${host}`);
        entry.host = host;
        if (entry.conn) {
          entry.conn.close();
          entry.conn = null;
          if (keep.has(guid)) {
            hub.connect(entry).catch(() => {});
          }
        }
      }
      return entry;
    },

    /** Move an entry known by its address only (`ip-…`) to its real GUID. */
    rename(entry, guid) {
      entries.delete(entry.guid);
      if (keep.has(entry.guid)) {
        keep.delete(entry.guid);
        keep.add(guid);
      }
      entry.guid = guid;
      entries.set(guid, entry);
      return entry;
    },

    /**
     * @description Connect (or reuse the connection), read everything.
     * @param {object} entry - Speaker entry.
     * @returns {Promise<object>} The entry.
     */
    async connect(entry) {
      if (entry.conn?.isOpen()) {
        return entry;
      }
      if (!entry.connecting) {
        clearTimeout(entry.retryTimer);
        entry.connecting = connectOnce(entry)
          .catch((error) => {
            lost(entry, error);
            throw error;
          })
          .finally(() => {
            entry.connecting = null;
          });
      }
      return entry.connecting;
    },

    /** Keep a speaker connected (created in Gladys), or not. */
    keep(guid, wanted = true) {
      if (wanted) {
        keep.add(guid);
        const entry = entries.get(guid);
        if (entry && !entry.conn && !entry.connecting && !stopped) {
          hub.connect(entry).catch(() => {});
        }
      } else {
        keep.delete(guid);
        hub.release(guid);
      }
    },

    isKept: (guid) => keep.has(guid),

    /** Close the connection of a speaker nobody needs. */
    release(guid) {
      const entry = entries.get(guid);
      if (entry && !keep.has(guid)) {
        clearTimeout(entry.retryTimer);
        entry.conn?.close();
        entry.conn = null;
      }
    },

    /**
     * @description Send a command; the answer, when it is a state, is applied.
     * @param {object} entry - Speaker entry.
     * @param {string} resource - Resource.
     * @param {string} method - Method.
     * @param {object} [body] - Body.
     * @param {string} [applyAs] - Resource whose state the answer is.
     * @returns {Promise<object>} The answer.
     */
    async command(entry, resource, method, body = {}, applyAs = resource) {
      if (!entry.conn?.isOpen()) {
        await hub.connect(entry);
      }
      let answer;
      try {
        answer = await entry.conn.request(resource, method, body);
      } catch (error) {
        if (error?.status !== 401) {
          throw error;
        }
        await account.renew();
        answer = await entry.conn.request(resource, method, body);
      }
      if (applyAs && answer && Object.keys(answer).length > 0 && apply(entry, applyAs, answer)) {
        notify(entry, applyAs);
      }
      return answer;
    },

    /** Read one resource again (after a command whose answer says nothing). */
    refresh: (entry, resource) =>
      tryRead(entry, resource).then((body) => {
        if (body) {
          notify(entry, resource);
        }
      }),

    start() {
      stopped = false;
      heartbeatTimer = setInterval(() => hub.heartbeat(), HEARTBEAT_MS);
      heartbeatTimer.unref?.();
      batteryTimer = setInterval(() => hub.batteries(), BATTERY_MS);
      batteryTimer.unref?.();
    },

    /** Liveness: a speaker that does not answer anymore is closed and retried. */
    async heartbeat() {
      await Promise.all(
        [...entries.values()]
          .filter((entry) => entry.conn?.isOpen())
          .map(async (entry) => {
            const conn = entry.conn;
            try {
              const body = await conn.request('/system/power/control');
              if (apply(entry, '/system/power/control', body)) {
                notify(entry, '/system/power/control');
              }
            } catch (error) {
              if (error?.kind === 'timeout' && entry.conn === conn) {
                conn.close();
                lost(entry, error);
              }
            }
          }),
      );
    },

    /** Battery of the portable speakers (in case a firmware does not push it). */
    async batteries() {
      await Promise.all(
        [...entries.values()]
          .filter((entry) => entry.conn?.isOpen() && entry.caps.has('/system/battery'))
          .map((entry) => hub.refresh(entry, '/system/battery')),
      );
    },

    stop() {
      stopped = true;
      clearInterval(heartbeatTimer);
      clearInterval(batteryTimer);
      for (const entry of entries.values()) {
        clearTimeout(entry.retryTimer);
        entry.conn?.close();
        entry.conn = null;
      }
    },
  };
  return hub;
}
