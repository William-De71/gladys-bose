// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   account     the Bose account token, obtained from the Bose cloud and
//               refreshed (src/account.js): the only thing that leaves the
//               local network
//   discovery   mediated mDNS scan (`_bose-passport._tcp`) through Gladys +
//               the addresses of the configuration, then a WebSocket to each
//               speaker to read its name, model and capabilities
//   states      the speakers the user created stay connected and push their
//               changes (src/hub.js); only the changes are published
//   commands    Gladys features, scene actions, widget buttons -> requests on
//               the WebSocket of the speaker
//   scenes      transitions pushed by the speakers -> scene events
//
// A speaker is identified by its GUID: when its address changes (DHCP), the
// next scan finds it again. The speakers seen are kept in /data so a restart
// connects them at once, without waiting for a scan.
// -----------------------------------------------------------------------------

import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { ACCOUNT_STATUS, createAccount } from './account.js';
import { createArtStore } from './art.js';
import { createBoseAuth } from './bose/auth.js';
import { BoseError } from './bose/connection.js';
import { isIpv4, mdnsScan, normalizeGuid } from './bose/discovery.js';
import { normalizeConfig } from './config.js';
import {
  buildDevice,
  commandFor,
  deviceName,
  DEVICE_TYPE,
  FEATURE_KEYS,
  featureValues,
  presetCommand,
  sourceCommand,
  sourceLabel,
  sourceValue,
  playingTexts,
} from './devices.js';
import { t, text, truncate, truncateAll } from './i18n.js';
import { createHub } from './hub.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { buildNowPlayingWidget, WIDGET_ACTIONS, WIDGETS } from './widgets.js';

export const ACTIONS = { TEST: 'test_connection' };

const MINUTE = 60 * 1000;
const RESCAN_SPACING_MS = 5 * MINUTE;
const UNREACHABLE_AFTER_MS = MINUTE;
const QUIET_AFTER_ACTION_MS = 5000;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const MAX_MESSAGE = 1800;
const LANGUAGES = ['en', 'fr', 'de', 'es'];

const ipId = (host) => `ip-${host.replaceAll('.', '-')}`;

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {object} [deps.auth] - src/bose/auth.js client (tests: the fake Bose cloud).
 * @param {Function} [deps.connect] - openConnection (tests: fake speakers).
 * @param {object} [deps.art] - src/art.js store.
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {object} [deps.timings] - `{ probeTimeoutMs, unreachableAfterMs, retryMs }` (tests: short).
 * @returns {object} `{ start, stop, scan, … }`.
 */
export function createApp(
  gladys,
  {
    auth = createBoseAuth(),
    connect,
    art = createArtStore(),
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    timings = {},
  } = {},
) {
  const unreachableAfterMs = timings.unreachableAfterMs ?? UNREACHABLE_AFTER_MS;
  let config = normalizeConfig(gladys.config ?? {});
  let stopped = false;
  let scanning = null;
  let lastScanAt = 0;
  let scanError = null;
  let statusKey = '';
  let rescanTimer = null;
  const created = new Set(); // device external ids
  const gladysNames = new Map(); // guid -> name in Gladys
  const widgetRefresh = new Map();
  const transports = new Map();

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`Bose: ${what} failed: ${error?.message ?? error}`));

  const account = createAccount({
    auth,
    storage,
    logger,
    now,
    onChange: () => publishStatus(),
  });

  const hub = createHub({
    account,
    ...(connect ? { connect } : {}),
    logger,
    onUpdate: (entry, what) => onSpeakerUpdate(entry, what),
    onRescan: () => requestRescan(),
    ...(timings.probeTimeoutMs ? { probeTimeoutMs: timings.probeTimeoutMs } : {}),
    ...(timings.retryMs ? { retryMs: timings.retryMs } : {}),
  });

  const deviceIdOf = (entry) => gladys.externalIds(DEVICE_TYPE, entry.guid).device;
  const isCreated = (entry) => created.has(deviceIdOf(entry));
  const nameOf = (entry) => gladysNames.get(entry.guid) || deviceName(entry);
  // Known: seen once (here or in /data). Ready: read in full during this run,
  // the only ones published to the Discover tab (an incomplete feature list
  // would offer an "Update" that removes features).
  const identified = () =>
    [...hub.entries.values()].filter((entry) => entry.info && !entry.guid.startsWith('ip-'));
  const ready = () => identified().filter((entry) => entry.ready);
  const createdEntries = () => identified().filter(isCreated);

  // --- Widgets, transports, status ---------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  // One channel: the badge of the catalog says it all, the per-device
  // transport only tells "local" from "unreachable".
  const publishTransport = (entry, force = false) => {
    const deviceId = deviceIdOf(entry);
    if (!created.has(deviceId) || entry.reachable === null) {
      return;
    }
    const transport = entry.reachable ? 'local' : 'unreachable';
    if (!force && transports.get(deviceId) === transport) {
      return;
    }
    transports.set(deviceId, transport);
    safely(
      () => gladys.publishTransports([{ external_id: deviceId, transport }]),
      'transport badge',
    );
  };

  function publishStatus() {
    const known = createdEntries().length > 0 ? createdEntries() : identified();
    const answering = known.filter((entry) => entry.reachable);
    const accountStatus = account.status();
    let key;
    let connected;
    let message;
    if (accountStatus === ACCOUNT_STATUS.MISSING) {
      [key, connected, message] = ['account-missing', false, t('statusNoAccount')];
    } else if (accountStatus === ACCOUNT_STATUS.REJECTED) {
      [key, connected, message] = ['account-rejected', false, t('statusRejected')];
    } else if (accountStatus === ACCOUNT_STATUS.UNAVAILABLE && !account.hasToken()) {
      [key, connected, message] = ['account-unavailable', false, t('statusUnavailable')];
    } else if (scanError === 'forbidden' && known.length === 0) {
      [key, connected, message] = ['forbidden', false, t('statusScanForbidden')];
    } else if (known.length === 0) {
      [key, connected, message] = ['none', true, t('statusNoSpeaker')];
    } else if (answering.length === 0) {
      key = `off:${known.length}`;
      [connected, message] = [true, t('statusAllOff', { count: known.length })];
    } else {
      key = `ok:${answering.length}:${known.length}`;
      connected = true;
      message = t('statusConnected', { count: answering.length, total: known.length });
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  }

  // --- States and scene events -------------------------------------------------------

  const pushStates = (entry) => {
    const ids = gladys.externalIds(DEVICE_TYPE, entry.guid);
    for (const [key, value] of featureValues(entry, config.language)) {
      states.push(ids.feature(key), value);
    }
  };

  const fire = (entry, key, data) => {
    if (!isCreated(entry) || (entry.quietUntil ?? 0) > now()) {
      return;
    }
    const event = { device: deviceIdOf(entry), device_name: truncate(nameOf(entry), 200), ...data };
    safely(() => gladys.publishSceneEvent(key, event), `scene event ${key}`);
  };

  /** Compare with what was seen last, fire one event per transition. */
  const detectTransitions = (entry) => {
    const playing = entry.on !== false && Boolean(entry.nowPlaying?.playing);
    const source = entry.on === false ? null : sourceValue(entry);
    const previous = entry.seen;
    entry.seen = { playing, source };
    if (!previous) {
      return;
    }
    const { title } = playingTexts(entry, config.language);
    const common = {
      title: truncate(title, 1000),
      artist: truncate(entry.on === false ? '' : (entry.nowPlaying?.artist ?? ''), 1000),
      source: source ?? 'standby',
    };
    if (playing && !previous.playing) {
      fire(entry, SCENE_TRIGGERS.PLAYBACK_STARTED, common);
    } else if (!playing && previous.playing) {
      fire(entry, SCENE_TRIGGERS.PLAYBACK_STOPPED, common);
    }
    if (source && previous.source && source !== previous.source) {
      fire(entry, SCENE_TRIGGERS.SOURCE_CHANGED, {
        source,
        source_name: truncate(sourceLabel(entry, config.language), 1000),
        previous_source: previous.source,
      });
    }
  };

  const watchReachability = (entry) => {
    clearTimeout(entry.unreachableTimer);
    entry.unreachableTimer = null;
    if (entry.reachable) {
      entry.unreachableFired = false;
      return;
    }
    if (entry.reachable === false && !entry.unreachableFired && isCreated(entry)) {
      entry.unreachableTimer = setTimeout(() => {
        entry.unreachableTimer = null;
        if (!stopped && entry.reachable === false && !entry.unreachableFired) {
          entry.unreachableFired = true;
          fire(entry, SCENE_TRIGGERS.SPEAKER_UNREACHABLE, { address: entry.host });
        }
      }, unreachableAfterMs);
      entry.unreachableTimer.unref?.();
    }
  };

  function onSpeakerUpdate(entry, what) {
    if (what === 'connection') {
      publishTransport(entry);
      publishStatus();
      watchReachability(entry);
      if (!entry.reachable) {
        // Nothing plays on a speaker that does not answer: forget, so its
        // return does not look like a transition.
        entry.seen = null;
      }
    } else {
      if (what === 'all') {
        entry.seen = null;
      }
      detectTransitions(entry);
      pushStates(entry);
      if (['/system/sources', '/system/productSettings', '/system/info'].includes(what)) {
        // New preset names, a renamed speaker: the options of the select.
        persist();
        publishDiscovered();
      }
    }
    refreshWidgets();
  }

  // --- Discovery -------------------------------------------------------------------------

  const persist = () =>
    safely(
      () =>
        storage.write(
          'speakers.json',
          Object.fromEntries(
            identified().map((entry) => [
              entry.guid,
              {
                host: entry.host,
                name: entry.info?.name ?? '',
                product: entry.info?.product ?? '',
                reportedGuid: entry.reportedGuid ?? entry.guid,
              },
            ]),
          ),
        ),
      'saving the speakers',
    );

  function publishDiscovered() {
    return safely(
      () =>
        gladys.publishDiscoveredDevices(
          ready().map((entry) => buildDevice(gladys, entry, config.language)),
        ),
      'discovery',
    );
  }

  /** Connect to a speaker, read it; an `ip-` entry gets its real GUID. */
  const probe = async (entry) => {
    try {
      await hub.connect(entry);
    } catch (error) {
      logger.info(`Bose: no Bose speaker answered at ${entry.host} (${error?.message ?? error})`);
      return null;
    }
    const guid = normalizeGuid(entry.reportedGuid);
    if (entry.guid.startsWith('ip-') && guid) {
      if (hub.entries.has(guid)) {
        // Already known by its GUID (mDNS, /data): keep that one, at this address.
        hub.entries.delete(entry.guid);
        entry.conn?.close();
        const known = hub.entryOf(guid, entry.host);
        await hub.connect(known).catch(() => null);
        return known.ready ? known : null;
      }
      hub.rename(entry, guid);
    }
    return entry.guid.startsWith('ip-') ? null : entry;
  };

  const scanOnce = async () => {
    lastScanAt = now();
    await account.token().catch(() => null);
    if (!account.hasToken()) {
      publishStatus();
      return [];
    }
    const found = await mdnsScan(gladys, { logger });
    scanError = found.error;
    const targets = new Set();
    for (const speaker of found.speakers.values()) {
      const entry = hub.entryOf(speaker.guid, speaker.host);
      entry.mdnsName = speaker.name || entry.mdnsName;
      targets.add(entry);
    }
    for (const host of config.hosts) {
      const known = [...hub.entries.values()].find((entry) => entry.host === host);
      targets.add(known ?? hub.entryOf(ipId(host), host));
    }
    const touched = (await Promise.all([...targets].map(probe))).filter(Boolean);
    // Discovered only: read, then let go (a speaker takes few clients).
    for (const entry of touched) {
      if (!hub.isKept(entry.guid)) {
        hub.release(entry.guid);
      }
    }
    persist();
    await publishDiscovered();
    publishStatus();
    return touched;
  };

  /** Run a scan, or join the one running. */
  const scan = () => {
    if (!scanning) {
      scanning = scanOnce().finally(() => {
        scanning = null;
      });
    }
    return scanning;
  };

  function requestRescan() {
    if (stopped || scanning || now() - lastScanAt < RESCAN_SPACING_MS) {
      return;
    }
    safely(() => scan(), 'scan');
  }

  const scheduleRescan = () => {
    clearInterval(rescanTimer);
    rescanTimer = null;
    if (!stopped && config.rescanMs > 0) {
      rescanTimer = setInterval(() => safely(() => scan(), 'scan'), config.rescanMs);
      rescanTimer.unref?.();
    }
  };

  // --- Commands ----------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  const entryFor = (externalId) => {
    const deviceId = String(externalId ?? '');
    const entry = [...hub.entries.values()].find(
      (candidate) =>
        deviceIdOf(candidate) === deviceId || deviceId.startsWith(`${deviceIdOf(candidate)}:`),
    );
    if (!entry) {
      throw userError('errorUnknownDevice');
    }
    return entry;
  };

  /** Run a command on a speaker, mapping errors to user texts. */
  const run = async (entry, task) => {
    try {
      return await task();
    } catch (error) {
      if (error instanceof RangeError) {
        throw userError('errorValue', { value: truncate(error.message, 60) });
      }
      if (error?.kind === 'token') {
        throw userError('errorNoAccount');
      }
      if (error instanceof BoseError && error.kind === 'speaker') {
        throw userError('errorRefused', {
          name: nameOf(entry),
          error: truncate(error.message, 200),
        });
      }
      throw userError('errorUnreachable', {
        name: nameOf(entry),
        error: truncate(error?.message ?? error, 200),
      });
    }
  };

  /** Send a command built by src/devices.js. */
  const send = (entry, command) =>
    run(entry, async () => {
      if (!command) {
        return null;
      }
      const answer = await hub.command(
        entry,
        command.resource,
        command.method,
        command.body,
        command.applyAs,
      );
      if (command.assume && (!answer || Object.keys(answer).length === 0)) {
        // No state in the answer: what was asked, the notification confirms it.
        Object.assign(entry, command.assume);
        onSpeakerUpdate(entry, command.resource);
      }
      return answer;
    });

  gladys.onSetValue(async (device, feature, value) => {
    const entry = entryFor(device.external_id);
    const key = String(feature.external_id).split(':').pop();
    if (key === FEATURE_KEYS.SOURCE) {
      await send(
        entry,
        await run(entry, async () => sourceCommand(entry, String(value), account.personId())),
      );
      return;
    }
    const command = await run(entry, async () => commandFor(entry, key, value));
    await send(entry, command);
  });

  // --- Device events ---------------------------------------------------------------------------

  const trackCreated = (device) => {
    if (!device?.external_id) {
      return null;
    }
    created.add(device.external_id);
    const guid = String(device.external_id).split(':').pop();
    const param = (name) => device.params?.find?.((item) => item.name === name)?.value;
    const host = hub.entries.get(guid)?.host ?? param('BOSE_HOST');
    if (!host || !isIpv4(host)) {
      return null;
    }
    const entry = hub.entryOf(guid, host);
    entry.info ??= { name: device.name ?? '', product: param('BOSE_MODEL') ?? '' };
    gladysNames.set(guid, device.name ?? '');
    hub.keep(guid);
    return entry;
  };

  gladys.onDeviceCreated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      // States published before the creation were thrown away by Gladys.
      states.republish(deviceIdOf(entry));
      pushStates(entry);
      publishTransport(entry, true);
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      states.republish(deviceIdOf(entry));
      pushStates(entry);
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      states.forget(device.external_id);
      const guid = String(device.external_id).split(':').pop();
      gladysNames.delete(guid);
      hub.keep(guid, false);
    }
    publishStatus();
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    await scan();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    const credentials = account.configure(config.email, config.password);
    if (credentials) {
      await account.renew({ force: true });
      publishStatus();
    }
    if (previous.language !== config.language) {
      createdEntries().forEach((entry) => pushStates(entry));
      await publishDiscovered();
    }
    if (previous.rescanMs !== config.rescanMs) {
      scheduleRescan();
    }
    if (credentials || previous.hosts.join(',') !== config.hosts.join(',')) {
      await scan();
      // Created speakers that could not connect without a token.
      createdEntries().forEach((entry) => hub.keep(entry.guid));
    }
  });

  // --- Configuration button ------------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    await account.renew({ force: false });
    const status = account.status();
    if (!account.hasToken()) {
      if (status === ACCOUNT_STATUS.MISSING) {
        return t('statusNoAccount');
      }
      return status === ACCOUNT_STATUS.REJECTED ? t('statusRejected') : t('statusUnavailable');
    }
    const touched = await scan();
    const known = [...new Set([...touched, ...identified()])];
    if (known.length === 0) {
      return scanError === 'forbidden' ? t('statusScanForbidden') : t('testNone');
    }
    const message = {};
    for (const language of LANGUAGES) {
      const list = known
        .map((entry) => {
          const details = [entry.info?.product || 'Bose', entry.host];
          if (!entry.reachable) {
            details.push(text('testUnreachable', language));
          }
          return `${nameOf(entry)} (${details.join(', ')})`;
        })
        .join(' ; ');
      message[language] = text('testOk', language, { count: known.length, list });
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions -----------------------------------------------------------------------------------

  const quiet = (...list) =>
    list.forEach((entry) => (entry.quietUntil = now() + QUIET_AFTER_ACTION_MS));

  gladys.onSceneAction(SCENE_ACTIONS.PLAY_PRESET, async (fields = {}) => {
    const entry = entryFor(fields.device);
    const id = String(fields.preset ?? '');
    const preset = (entry.presets ?? []).find((candidate) => candidate.id === id);
    if (!preset) {
      throw userError('errorPreset', { name: nameOf(entry), preset: truncate(id, 4) });
    }
    quiet(entry);
    await send(entry, presetCommand(preset, account.personId()));
    quiet(entry);
    return { preset_name: truncate(preset.name || id, 200) };
  });

  // Group members are named by the GUID as the speakers write it.
  const productId = (entry) => entry.reportedGuid || entry.guid;
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const byProduct = (id) => [...hub.entries.values()].find((entry) => same(productId(entry), id));

  gladys.onSceneAction(SCENE_ACTIONS.GROUP_SPEAKERS, async (fields = {}) => {
    const leader = entryFor(fields.leader);
    const wanted = Array.isArray(fields.members) ? fields.members : [fields.members];
    const members = [
      ...new Set(wanted.filter(Boolean).map((externalId) => entryFor(externalId))),
    ].filter((entry) => entry !== leader);
    if (members.length === 0) {
      throw userError('errorGroupEmpty', { name: nameOf(leader) });
    }
    const group = leader.group;
    if (group && group.master && !same(group.master, productId(leader))) {
      const master = byProduct(group.master);
      throw userError('errorGroupMaster', {
        name: nameOf(leader),
        master: master ? nameOf(master) : group.master,
      });
    }
    quiet(leader, ...members);
    const role = (entry) => ({ productId: productId(entry), role: 'NORMAL' });
    if (group) {
      const adding = members.filter(
        (entry) => !group.members.some((member) => same(member, productId(entry))),
      );
      if (adding.length > 0) {
        await run(leader, () =>
          hub.command(
            leader,
            '/grouping/activeGroups',
            'PUT',
            {
              activeGroupId: group.id,
              addProducts: adding.map(role),
              addGroups: [],
              removeGroups: [],
              removeProducts: [],
            },
            null,
          ),
        );
      }
    } else {
      await run(leader, () =>
        hub.command(
          leader,
          '/grouping/activeGroups',
          'POST',
          { products: [leader, ...members].map(role) },
          null,
        ),
      );
    }
    await hub.refresh(leader, '/grouping/activeGroups');
    quiet(leader, ...members);
    return { group_size: leader.group?.members.length ?? members.length + 1 };
  });

  gladys.onSceneAction(SCENE_ACTIONS.UNGROUP_SPEAKER, async (fields = {}) => {
    const entry = entryFor(fields.device);
    const group = entry.group;
    if (!group) {
      throw userError('errorNotGrouped', { name: nameOf(entry) });
    }
    quiet(entry);
    if (!group.master || same(group.master, productId(entry))) {
      await run(entry, () => hub.command(entry, '/grouping/activeGroups', 'DELETE', {}, null));
      await hub.refresh(entry, '/grouping/activeGroups');
      return undefined;
    }
    const master = byProduct(group.master);
    if (!master) {
      throw userError('errorUnknownDevice');
    }
    quiet(master);
    await run(master, () =>
      hub.command(
        master,
        '/grouping/activeGroups',
        'PUT',
        {
          name: '',
          activeGroupId: group.id,
          addProducts: [],
          addGroups: [],
          removeGroups: [],
          removeProducts: [{ productId: productId(entry), role: 'NORMAL' }],
        },
        null,
      ),
    );
    await Promise.all([
      hub.refresh(master, '/grouping/activeGroups'),
      hub.refresh(entry, '/grouping/activeGroups'),
    ]);
    return undefined;
  });

  // --- Widget --------------------------------------------------------------------------------------

  const groupView = (entry) => {
    const group = entry.group;
    if (!group) {
      return null;
    }
    if (!group.master || same(group.master, productId(entry))) {
      return { leads: group.members.length - 1 };
    }
    const master = byProduct(group.master);
    return { follows: master ? nameOf(master) : '?' };
  };

  const viewOf = async (entry) => {
    const playing = entry.nowPlaying ?? {};
    const active = entry.reachable && entry.on !== false;
    const tv = active && sourceValue(entry) === 'tv';
    return {
      deviceId: deviceIdOf(entry),
      name: nameOf(entry),
      reachable: Boolean(entry.reachable),
      on: entry.on !== false,
      status: playing.status ?? '',
      title: tv ? text('source_tv', config.language) : (playing.title ?? ''),
      artist: tv ? '' : (playing.artist ?? ''),
      source: sourceLabel(entry, config.language),
      volume: Number.isFinite(entry.volume) ? entry.volume : null,
      muted: entry.muted === true,
      battery: entry.battery,
      group: groupView(entry),
      image: active && playing.art ? await art.keyFor(playing.art) : undefined,
    };
  };

  gladys.onWidgetGet(WIDGETS.NOW_PLAYING, async ({ settings } = {}) => {
    const entry = createdEntries().find((candidate) => deviceIdOf(candidate) === settings?.device);
    return buildNowPlayingWidget(entry ? await viewOf(entry) : null);
  });

  gladys.onWidgetGetImage(async (imageKey) => art.image(imageKey));

  const toast = (error) =>
    truncateAll(
      { en: error.message, fr: error.message, de: error.message, es: error.message },
      200,
    );

  const WIDGET_COMMANDS = {
    [WIDGET_ACTIONS.PREVIOUS]: [FEATURE_KEYS.PREVIOUS, 1],
    [WIDGET_ACTIONS.PLAY]: [FEATURE_KEYS.PLAY, 1],
    [WIDGET_ACTIONS.PAUSE]: [FEATURE_KEYS.PAUSE, 1],
    [WIDGET_ACTIONS.NEXT]: [FEATURE_KEYS.NEXT, 1],
    [WIDGET_ACTIONS.POWER_ON]: [FEATURE_KEYS.POWER, 1],
    [WIDGET_ACTIONS.POWER_OFF]: [FEATURE_KEYS.POWER, 0],
  };

  gladys.onWidgetAction(WIDGETS.NOW_PLAYING, async (actionKey, params = {}, { settings } = {}) => {
    const command = WIDGET_COMMANDS[actionKey];
    if (!command) {
      return undefined;
    }
    try {
      const entry = entryFor(settings?.device ?? params.device);
      await send(entry, commandFor(entry, ...command));
      refreshWidgets();
      return truncateAll(t('widgetDone', { name: nameOf(entry) }), 200);
    } catch (error) {
      return toast(error);
    }
  });

  // --- Lifecycle -------------------------------------------------------------------------------------

  return {
    /** Restore the known speakers, sign in, connect the created ones, then scan. */
    async start() {
      stopped = false;
      config = normalizeConfig(gladys.config ?? {});
      account.configure(config.email, config.password);
      created.clear();
      const saved = (await storage.read('speakers.json')) ?? {};
      for (const [guid, info] of Object.entries(saved)) {
        if (normalizeGuid(guid) === guid && isIpv4(info?.host)) {
          const entry = hub.entryOf(guid, info.host);
          entry.info ??= { name: String(info.name ?? ''), product: String(info.product ?? '') };
          entry.reportedGuid ??= String(info.reportedGuid ?? guid);
        }
      }
      await account.start();
      publishStatus();
      hub.start();
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      scheduleRescan();
      await scan();
    },

    async stop() {
      stopped = true;
      clearInterval(rescanTimer);
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      for (const entry of hub.entries.values()) {
        clearTimeout(entry.unreachableTimer);
      }
      account.stop();
      hub.stop();
      states.stop();
      await Promise.allSettled([scanning]);
    },

    scan,
    flushStates: () => states.flush(),
    hub,
    account,
  };
}
