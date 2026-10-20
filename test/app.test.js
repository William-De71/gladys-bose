// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), the fake Bose cloud and fake
// speakers on real local WebSockets (test/helpers.js): sign-in, discovery,
// pushed states, commands, scene triggers and actions, widget, lost
// speakers, address changes. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { createArtStore } from '../src/art.js';
import { createBoseAuth } from '../src/bose/auth.js';
import { SCENE_ACTION_OUTPUTS, SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import {
  EMAIL,
  fakeWorld,
  FakeSpeaker,
  KITCHEN_GUID,
  PASSWORD,
  PNG,
  SALON_GUID,
  until,
} from './helpers.js';

const CONFIG = { email: EMAIL, password: PASSWORD, language: 'fr', hosts: '10.0.0.2' };
const id = (guid) => `ext:test-integration:speaker:${guid}`;
const SALON = id(SALON_GUID);
const KITCHEN = id(KITCHEN_GUID);

const speakers = () => [
  new FakeSpeaker({ guid: SALON_GUID, host: '192.168.1.50', name: 'Salon' }),
  // On another subnet, typed in the configuration: no mDNS answer reaches Gladys.
  new FakeSpeaker({
    guid: KITCHEN_GUID,
    host: '10.0.0.2',
    name: 'Cuisine',
    product: 'Bose Portable Smart Speaker',
    soundbar: false,
    battery: true,
    unlisted: ['midrange'],
  }),
];

const fakeArtFetch = async (url) =>
  String(url).startsWith('https://i.scdn.co/')
    ? new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
    : new Response('not found', { status: 404 });

/**
 * @description An integration wired to the fake Gladys, cloud and speakers.
 * @param {object} [options] - `{ config, create, storage, list, prepare }`.
 * @returns {Promise<object>} `{ gladys, fake, app, world, logs, salon, kitchen }`.
 */
async function setup({
  config = CONFIG,
  create = true,
  storage = memoryStorage(),
  list,
  prepare = () => {},
} = {}) {
  const all = list ?? speakers();
  const world = await fakeWorld(all);
  prepare(world, all);
  const gladys = createFakeGladys({ config: structuredClone(config) });
  // The core browses the mDNS of its own LAN only.
  const lan = () =>
    world.network.mdns().filter((result) => result.addresses[0].startsWith('192.168.'));
  gladys.scanNetwork = async (type) => {
    assert.equal(type, 'mdns');
    return lan();
  };
  const logs = [];
  const log = (line) => logs.push(String(line));
  const app = createApp(gladys, {
    auth: createBoseAuth({ fetch: world.cloud.fetch }),
    connect: world.connect,
    art: createArtStore({ fetch: fakeArtFetch }),
    storage,
    logger: { debug: log, info: log, warn: log, error: log },
    timings: { probeTimeoutMs: 150, unreachableAfterMs: 200, retryMs: [100, 200] },
  });
  try {
    await gladys.connect();
    await app.start();
    if (create) {
      for (const device of gladys.fake.discoveredDevices) {
        await gladys.fake.deviceCreated(structuredClone(device));
      }
      await until(() =>
        [...app.hub.entries.values()].every((entry) => entry.conn?.isOpen() && entry.reachable),
      );
      await app.flushStates();
    }
  } catch (error) {
    await app.stop();
    await world.stop();
    throw error;
  }
  const [salon, kitchen] = all;
  const stop = async () => {
    await app.stop();
    await world.stop();
    for (const line of logs) {
      assert.ok(!line.includes(PASSWORD), `a log line shows the password: ${line}`);
      assert.ok(!/eyJ[\w-]+\.eyJ/.test(line), `a log line shows a token: ${line}`);
    }
  };
  return { gladys, fake: gladys.fake, app, world, logs, salon, kitchen, stop };
}

const ok = (ack) => {
  assert.equal(ack.success, true, ack.error);
  return ack.data;
};
const deviceOf = (fake, externalId) =>
  structuredClone(fake.discoveredDevices.find((device) => device.external_id === externalId));
const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
const last = (fake, externalId, key) => fake.lastState(`${externalId}:${key}`);
const setValue = (fake, externalId, key, value) => {
  const device = deviceOf(fake, externalId);
  return fake.setValue(device, featureOf(device, key), value);
};
const settle = async (app) => {
  await new Promise((resolve) => setTimeout(resolve, 60));
  await app.flushStates();
};

test('discovery: speakers found by mDNS and by typed address, identified by GUID', async () => {
  const { fake, app, world, stop } = await setup({ create: false });
  try {
    const ids = fake.discoveredDevices.map((device) => device.external_id).sort();
    assert.deepEqual(ids, [SALON, KITCHEN].sort());
    const salon = deviceOf(fake, SALON);
    assert.equal(salon.name, 'Salon');
    assert.equal(salon.model, 'Bose Smart Soundbar');
    assert.equal(featureOf(salon, 'power').name, 'Marche/veille');
    // The portable lists no midrange but answers it: asked anyway.
    assert.ok(featureOf(deviceOf(fake, KITCHEN), 'midrange'));
    assert.ok(featureOf(deviceOf(fake, KITCHEN), 'battery'));
    // Discovered only: read, then disconnected.
    await until(() => [...app.hub.entries.values()].every((entry) => !entry.conn));
    assert.equal(world.cloud.logins, 1);
    assert.equal(fake.connectionStatus.connected, true);
  } finally {
    await stop();
  }
});

test('no Bose account: nothing found, nothing sent to Bose, the status says why', async () => {
  const { fake, world, stop } = await setup({ config: { language: 'en' }, create: false });
  try {
    assert.deepEqual(fake.discoveredDevices, []);
    assert.equal(world.cloud.calls.length, 0);
    assert.equal(world.network.connections, 0);
    assert.equal(fake.connectionStatus.connected, false);
    assert.match(fake.connectionStatus.message.en, /e-mail and password of your Bose account/);
  } finally {
    await stop();
  }
});

test('states: published once created, then pushed by the speaker without polling', async () => {
  const { fake, app, salon, kitchen, stop } = await setup();
  try {
    assert.equal(last(fake, SALON, 'power'), 1);
    assert.equal(last(fake, SALON, 'volume'), 30);
    assert.equal(last(fake, SALON, 'playback-state'), 1);
    assert.equal(last(fake, SALON, 'title'), 'So What');
    assert.equal(last(fake, SALON, 'center'), '-20');
    assert.equal(last(fake, KITCHEN, 'battery'), 64);
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === SALON).at(-1).transport,
      'local',
    );

    // Changed from the Bose app: the speaker pushes it.
    salon.handle('PUT', '/audio/volume', { value: 12 });
    salon.handle('PUT', '/content/transportControl', { state: 'SKIPNEXT' });
    kitchen.battery = { percent: 63, chargeStatus: 'CHARGING' };
    kitchen.push('/system/battery', kitchen.battery);
    await until(async () => {
      await app.flushStates();
      return last(fake, KITCHEN, 'charging') === 1;
    });
    assert.equal(last(fake, SALON, 'volume'), 12);
    assert.equal(last(fake, SALON, 'title'), 'Freddie Freeloader');
    assert.equal(last(fake, KITCHEN, 'battery'), 63);
    const polls = salon.requests.filter(
      (request) => request.resource === '/audio/volume' && request.method === 'GET',
    );
    assert.ok(polls.length <= 2, 'read when connecting, never polled');
  } finally {
    await stop();
  }
});

test('commands: every feature reaches the speaker', async () => {
  const { fake, app, salon, world, stop } = await setup();
  try {
    ok(await setValue(fake, SALON, 'volume', 45));
    assert.equal(salon.volume.value, 45);
    ok(await setValue(fake, SALON, 'mute', 1));
    assert.equal(salon.volume.muted, true);
    ok(await setValue(fake, SALON, 'pause', 1));
    assert.equal(salon.playing.status, 'PAUSED');
    ok(await setValue(fake, SALON, 'play', 1));
    ok(await setValue(fake, SALON, 'next', 1));
    assert.equal(salon.playing.title, 'Freddie Freeloader');
    ok(await setValue(fake, SALON, 'previous', 1));
    ok(await setValue(fake, SALON, 'bass', '30'));
    assert.equal(salon.audio.bass, 30);
    ok(await setValue(fake, SALON, 'audio-mode', 'DIALOG'));
    assert.equal(salon.mode, 'DIALOG');
    ok(await setValue(fake, SALON, 'source', 'optical'));
    assert.equal(salon.playing.account, 'AUX_DIGITAL');
    ok(await setValue(fake, SALON, 'source', 'preset-2'));
    assert.equal(salon.playing.location, 'spotify:playlist:jazz');
    assert.equal(salon.lastInitiator, 'person-1', 'the Bose person id of the account');
    const before = salon.requests.length;
    ok(await setValue(fake, SALON, 'source', 'other'));
    assert.equal(salon.requests.length, before, '"Other" sends nothing');
    ok(await setValue(fake, SALON, 'power', 0));
    await settle(app);
    assert.equal(last(fake, SALON, 'power'), 0);
    assert.equal(last(fake, SALON, 'title'), 'Veille');
    ok(await setValue(fake, SALON, 'power', 1));
    await settle(app);
    assert.equal(last(fake, SALON, 'power'), 1);
    assert.equal(last(fake, SALON, 'volume'), 45);

    const refused = await setValue(fake, SALON, 'bass', '500');
    assert.equal(refused.success, false);
    assert.match(refused.error, /Valeur non acceptée/);

    // A token the speaker does not accept anymore: renewed, then sent again.
    salon.token = 'revoked';
    world.cloud.onAccessToken = (token) => (salon.token = token);
    ok(await setValue(fake, SALON, 'volume', 20));
    assert.equal(salon.volume.value, 20);
    assert.equal(world.cloud.refreshes, 1);
  } finally {
    await stop();
  }
});

test('scene triggers: one event per transition, none after a scene action', async () => {
  const { fake, app, salon, stop } = await setup();
  try {
    const events = () => fake.sceneEvents.map((event) => event.key);
    salon.handle('PUT', '/content/transportControl', { state: 'PAUSE' });
    await until(() => events().includes('playback_stopped'));
    salon.handle('PUT', '/content/transportControl', { state: 'PAUSE' });
    salon.handle('PUT', '/content/transportControl', { state: 'PLAY' });
    await until(() => events().includes('playback_started'));
    salon.handle('POST', '/content/playbackRequest', { source: 'PRODUCT', sourceAccount: 'TV' });
    await until(() => events().includes('source_changed'));
    assert.deepEqual(events(), ['playback_stopped', 'playback_started', 'source_changed']);
    const changed = fake.sceneEvents.at(-1).data;
    assert.deepEqual(changed, {
      device: SALON,
      device_name: 'Salon',
      source: 'tv',
      source_name: 'TV',
      previous_source: 'other',
    });
    for (const event of fake.sceneEvents) {
      assert.deepEqual(Object.keys(event.data).sort(), [...SCENE_TRIGGER_DATA[event.key]].sort());
      for (const value of Object.values(event.data)) {
        assert.ok(['string', 'number', 'boolean'].includes(typeof value));
      }
    }
    // A scene action plays a preset: the speaker changes, no event.
    ok(await fake.sceneAction('play_preset', { device: SALON, preset: '1' }));
    await settle(app);
    assert.equal(fake.sceneEvents.length, 3);
  } finally {
    await stop();
  }
});

test('a lost speaker: unreachable badge, one event after a minute, back on its own', async () => {
  const { fake, app, world, salon, stop } = await setup();
  try {
    await world.network.unplug(salon);
    await until(() => fake.sceneEvents.some((event) => event.key === 'speaker_unreachable'));
    const event = fake.sceneEvents.find((candidate) => candidate.key === 'speaker_unreachable');
    assert.deepEqual(event.data, { device: SALON, device_name: 'Salon', address: '192.168.1.50' });
    assert.ok(
      fake.transports.some(
        (item) => item.device_external_id === SALON && item.transport === 'unreachable',
      ),
    );
    const refused = await setValue(fake, SALON, 'volume', 10);
    assert.equal(refused.success, false);
    assert.match(refused.error, /Salon ne répond pas/);

    await world.network.plug(salon);
    await until(() => app.hub.entries.get(SALON_GUID).reachable === true);
    assert.equal(
      fake.transports.filter((item) => item.device_external_id === SALON).at(-1).transport,
      'local',
    );
    assert.equal(
      fake.sceneEvents.filter((candidate) => candidate.key === 'speaker_unreachable').length,
      1,
    );
  } finally {
    await stop();
  }
});

test('a new address (DHCP): found again by its GUID at the next scan', async () => {
  const { fake, app, world, salon, stop } = await setup();
  try {
    await world.network.unplug(salon);
    salon.host = '192.168.1.77';
    await world.network.plug(salon);
    await fake.scanRequest();
    await until(() => app.hub.entries.get(SALON_GUID).conn?.isOpen());
    assert.equal(app.hub.entries.get(SALON_GUID).host, '192.168.1.77');
    const params = deviceOf(fake, SALON).params;
    assert.equal(params.find((param) => param.name === 'BOSE_HOST').value, '192.168.1.77');
    ok(await setValue(fake, SALON, 'volume', 33));
    assert.equal(salon.volume.value, 33);
  } finally {
    await stop();
  }
});

test('scene actions: presets and groups, only the declared outputs', async () => {
  const { fake, app, world, stop } = await setup();
  try {
    const preset = ok(await fake.sceneAction('play_preset', { device: SALON, preset: '2' }));
    assert.deepEqual(preset.outputs, { preset_name: 'Jazz' });
    const missing = await fake.sceneAction('play_preset', { device: SALON, preset: '5' });
    assert.equal(missing.success, false);
    assert.match(missing.error, /pas de préréglage 5/);

    const empty = await fake.sceneAction('group_speakers', { leader: SALON, members: [SALON] });
    assert.equal(empty.success, false);

    const grouped = ok(
      await fake.sceneAction('group_speakers', { leader: SALON, members: [KITCHEN] }),
    );
    assert.deepEqual(grouped.outputs, { group_size: 2 });
    await until(() => app.hub.entries.get(KITCHEN_GUID).group !== null);
    assert.equal(world.network.groups.length, 1);

    // The follower cannot lead.
    const follower = await fake.sceneAction('group_speakers', {
      leader: KITCHEN,
      members: [SALON],
    });
    assert.equal(follower.success, false);
    assert.match(follower.error, /lancez le groupe depuis Salon/);

    ok(await fake.sceneAction('ungroup_speaker', { device: KITCHEN }));
    await until(() => app.hub.entries.get(SALON_GUID).group === null);
    assert.equal(world.network.groups.length, 0);
    const alone = await fake.sceneAction('ungroup_speaker', { device: KITCHEN });
    assert.match(alone.error, /n’est dans aucun groupe/);

    for (const [key, outputs] of Object.entries({
      play_preset: preset.outputs,
      group_speakers: grouped.outputs,
    })) {
      assert.deepEqual(Object.keys(outputs), SCENE_ACTION_OUTPUTS[key]);
    }
  } finally {
    await stop();
  }
});

test('widget: playing with the cover, standby, unreachable, no device; buttons', async () => {
  const { fake, app, world, salon, kitchen, stop } = await setup();
  try {
    const get = async (device, language = 'fr') =>
      ok(await fake.widgetGet('now_playing', { settings: { device }, language })).content;
    const playing = await get(SALON);
    assert.deepEqual(validateWidgetContent(playing), []);
    const image = playing.components.find((component) => component.type === 'image');
    assert.match(image.key, /^art-[0-9a-f]{20}$/);
    const bytes = ok(await fake.widgetGetImage(image.key)).image;
    assert.deepEqual(validateWidgetImage(bytes), []);
    assert.equal(playing.components[1].text, 'So What — Miles Davis');

    const toast = ok(
      await fake.widgetAction(
        'now_playing',
        'pause',
        { device: SALON },
        { settings: { device: SALON } },
      ),
    );
    assert.equal(toast.message.fr, 'Envoyé à Salon.');
    assert.equal(salon.playing.status, 'PAUSED');
    ok(
      await fake.widgetAction(
        'now_playing',
        'power_off',
        { device: SALON },
        { settings: { device: SALON } },
      ),
    );
    await settle(app);
    const standby = await get(SALON);
    assert.deepEqual(validateWidgetContent(standby), []);
    assert.deepEqual(
      standby.components
        .filter((component) => component.type === 'button')
        .map((button) => button.action.key),
      ['power_on'],
    );

    const portable = await get(KITCHEN, 'en');
    assert.deepEqual(validateWidgetContent(portable), []);
    assert.ok(JSON.stringify(portable).includes('"value":"64 %"'));

    await world.network.unplug(kitchen);
    await until(() => app.hub.entries.get(KITCHEN_GUID).reachable === false);
    const offline = await get(KITCHEN);
    assert.deepEqual(validateWidgetContent(offline), []);
    assert.equal(offline.components.filter((component) => component.type === 'button').length, 0);

    assert.deepEqual(validateWidgetContent(await get('ext:test-integration:speaker:nope')), []);
    const failed = ok(
      await fake.widgetAction(
        'now_playing',
        'next',
        { device: KITCHEN },
        { settings: { device: KITCHEN } },
      ),
    );
    assert.match(failed.message.fr, /Cuisine ne répond pas/);
  } finally {
    await stop();
  }
});

test('configuration button: the account, then every speaker', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const message = ok(await fake.action('test_connection', {})).message;
    assert.match(message.fr, /^Compte Bose OK\. 2 enceinte\(s\) trouvée\(s\) : /);
    assert.match(message.en, /Salon \(Bose Smart Soundbar, 192\.168\.1\.50\)/);
  } finally {
    await stop();
  }
  const refused = await setup({ config: { ...CONFIG, password: 'wrong' }, create: false });
  try {
    const message = ok(await refused.fake.action('test_connection', {})).message;
    assert.match(message.en, /Bose refused the e-mail or the password/);
  } finally {
    await refused.stop();
  }
});

test('configuration: new credentials sign in again, a new language renames', async () => {
  const { fake, world, stop } = await setup({
    config: { ...CONFIG, password: 'wrong' },
    create: false,
  });
  try {
    assert.deepEqual(fake.discoveredDevices, []);
    assert.equal(fake.connectionStatus.connected, false);
    await fake.configUpdated({ ...CONFIG, language: 'de' });
    assert.equal(world.cloud.logins, 1);
    assert.equal(fake.discoveredDevices.length, 2);
    assert.equal(featureOf(deviceOf(fake, SALON), 'bass').name, 'Bass');
    assert.equal(featureOf(deviceOf(fake, SALON), 'power').name, 'Ein/Standby');
    assert.equal(fake.connectionStatus.connected, true);
  } finally {
    await stop();
  }
});

test('a restart: the token and the speakers come from /data', async () => {
  const storage = memoryStorage();
  const first = await setup({ storage });
  const logins = first.world.cloud.logins;
  await first.stop();
  assert.ok(storage.files['speakers.json'][SALON_GUID]);
  assert.ok(storage.files['account.json'].accessToken);
  assert.equal(logins, 1);

  // A new fake cloud: a sign-in would show up in its counters. The speakers
  // accept the token saved by the first run.
  const saved = storage.files['account.json'].accessToken;
  const second = await setup({
    storage,
    create: false,
    prepare: (world, list) => list.forEach((speaker) => (speaker.token = saved)),
  });
  try {
    assert.equal(second.world.cloud.logins + second.world.cloud.refreshes, 0);
    assert.equal(second.fake.discoveredDevices.length, 2);
  } finally {
    await second.stop();
  }
});
