// Speakers -> Gladys devices. The Discover tab pitfalls of the Gladys core are
// checked here: a single invalid feature makes the whole discovery list
// refused, a missing min / max / read_only / has_feedback only fails when the
// user clicks "Add", and a category/type pair the front does not label shows
// "Device (undefined)".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import {
  parseAudioMode,
  parseAudioSetting,
  parseNowPlaying,
  parsePresets,
  parseSources,
} from '../src/bose/model.js';
import { normalizeConfig } from '../src/config.js';
import {
  buildDevice,
  commandFor,
  deviceName,
  featureValues,
  modeLabel,
  settingOptions,
  sourceCommand,
  sourceLabel,
  sourceValue,
} from '../src/devices.js';
import { createStatePublisher } from '../src/states.js';
import { fakeClock, FakeSpeaker, SALON_GUID, silentLogger } from './helpers.js';

// Pairs labeled by the Gladys front (deviceFeatureCategory in
// front/src/config/i18n/en.json, checked on v5.2.1 and master 2026-10-19).
const LABELED = {
  music: new Set(['volume', 'play', 'pause', 'previous', 'next', 'playback_state']),
  switch: new Set(['binary']),
  text: new Set(['text', 'select']),
  battery: new Set(['integer', 'charging']),
};

/** A speaker entry as the hub fills it, from the bodies of a fake speaker. */
function entryOf(options = {}) {
  const speaker = new FakeSpeaker({ guid: SALON_GUID, host: '192.168.1.50', ...options });
  const audio = {};
  for (const [key, resource] of [
    ['bass', 'bass'],
    ['treble', 'treble'],
    ['center', 'center'],
    ['surround', 'surround'],
    ['height', 'height'],
  ]) {
    if (resource in speaker.audio) {
      audio[key] = parseAudioSetting(speaker.audioBody(resource));
    }
  }
  return {
    guid: SALON_GUID,
    host: speaker.host,
    info: { name: speaker.name, product: speaker.product, firmware: '23.2.6' },
    caps: new Set(options.battery ? ['/system/battery'] : []),
    on: true,
    volume: 30,
    muted: false,
    nowPlaying: parseNowPlaying(speaker.nowPlaying()),
    sources: parseSources(speaker.sources()),
    presets: parsePresets(speaker.productSettings()),
    audio,
    mode: speaker.soundbar ? parseAudioMode(speaker.modeBody()) : null,
    battery: options.battery ? { percent: 64, charging: true } : null,
  };
}

test('every feature: labeled pair, bounds, read_only, has_feedback', () => {
  const gladys = createFakeGladys();
  for (const entry of [entryOf(), entryOf({ soundbar: false, battery: true })]) {
    const device = buildDevice(gladys, entry, 'en');
    assert.equal(device.should_poll, false, 'pushed over the WebSocket');
    assert.equal(device.poll_frequency, undefined);
    for (const feature of device.features) {
      const where = feature.external_id;
      assert.ok(
        LABELED[feature.category]?.has(feature.type),
        `${where} ${feature.category}/${feature.type}`,
      );
      for (const field of ['min', 'max', 'read_only', 'has_feedback', 'keep_history']) {
        assert.notEqual(feature[field], undefined, `${where} ${field}`);
      }
      assert.ok(feature.min <= feature.max, where);
      if (feature.type === 'select') {
        assert.ok(feature.supported_options.length >= 2, where);
        for (const option of feature.supported_options) {
          assert.equal(typeof option.value, 'string', where);
          assert.equal(typeof option.label, 'string', where);
        }
      }
    }
    assert.deepEqual(
      device.params.map((param) => param.name),
      ['BOSE_HOST', 'BOSE_MODEL', 'BOSE_FIRMWARE'],
    );
  }
});

test('features follow what the speaker has', () => {
  const gladys = createFakeGladys();
  const keys = (entry) =>
    buildDevice(gladys, entry, 'en').features.map((feature) =>
      feature.external_id.split(':').pop(),
    );
  const soundbar = keys(entryOf());
  assert.ok(soundbar.includes('center') && soundbar.includes('audio-mode'));
  assert.ok(!soundbar.includes('battery'));
  const portable = keys(entryOf({ soundbar: false, battery: true }));
  assert.ok(portable.includes('battery') && portable.includes('charging'));
  assert.ok(!portable.includes('center') && !portable.includes('audio-mode'));
});

test('the whole discovery list is accepted by the fake Gladys, in every language', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const devices = [
      buildDevice(gladys, entryOf(), language),
      buildDevice(
        gladys,
        { ...entryOf({ soundbar: false, battery: true }), guid: 'abcd-0001' },
        language,
      ),
    ];
    const result = await gladys.publishDiscoveredDevices(devices);
    assert.equal(result.count, devices.length);
  }
});

test('discovery baseline (0.1.0): external ids and compared fields never change', () => {
  // Changing a feature key, category, type, unit, min, max or step forces
  // users to delete and recreate their devices: update the baseline only on
  // purpose (UPDATE_BASELINE=1 npm test), with a migration note in the docs.
  const file = new URL('./fixtures/discovery.baseline.json', import.meta.url);
  const gladys = createFakeGladys();
  const describe = (device) => ({
    external_id: device.external_id,
    should_poll: device.should_poll,
    features: device.features.map((feature) => ({
      external_id: feature.external_id,
      category: feature.category,
      type: feature.type,
      unit: feature.unit ?? null,
      min: feature.min,
      max: feature.max,
      step: feature.step ?? null,
      read_only: feature.read_only,
    })),
  });
  const current = {
    soundbar: describe(buildDevice(gladys, entryOf(), 'en')),
    portable: describe(buildDevice(gladys, entryOf({ soundbar: false, battery: true }), 'en')),
  };
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(file, 'utf8')));
});

test('names: the name given in the Bose app, the model otherwise', () => {
  assert.equal(deviceName({ guid: SALON_GUID, info: { name: 'Salon' } }), 'Salon');
  assert.equal(deviceName({ guid: SALON_GUID, info: null, mdnsName: 'Cuisine' }), 'Cuisine');
  assert.equal(
    deviceName({ guid: SALON_GUID, info: { name: '', product: 'Bose Smart Soundbar' } }),
    'Bose Smart Soundbar 4A5B',
  );
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, entryOf(), 'fr');
  const names = Object.fromEntries(
    device.features.map((feature) => [feature.external_id.split(':').pop(), feature.name]),
  );
  assert.equal(names.bass, 'Graves');
  assert.equal(names['audio-mode'], 'Mode dialogue');
  const source = device.features.find((feature) => feature.external_id.endsWith(':source'));
  assert.deepEqual(
    source.supported_options.map((option) => option.label),
    ['Autre', 'TV', 'Optique', 'Préréglage 1 · FIP', 'Préréglage 2 · Jazz'],
  );
  assert.equal(modeLabel('DIALOG', 'de'), 'Dialog');
  assert.equal(modeLabel('SPEECH_BOOST', 'en'), 'Speech boost');
});

test('sound settings: one option per step, raw values', () => {
  const options = settingOptions({ min: -100, max: 100, step: 10 });
  assert.equal(options.length, 21);
  assert.deepEqual(options[0], { value: '-100', label: '-100' });
  assert.deepEqual(options[20], { value: '100', label: '+100' });
  assert.equal(settingOptions({ min: -100, max: 100, step: 1 }), null, 'too many for a select');
});

test('values: states, texts, sources', () => {
  const entry = entryOf();
  const values = Object.fromEntries(featureValues(entry, 'en'));
  assert.equal(values.power, 1);
  assert.equal(values.volume, 30);
  assert.equal(values.mute, 0);
  assert.equal(values['playback-state'], 1);
  assert.deepEqual(values.source, { text: 'other' });
  assert.deepEqual(values.title, { text: 'So What' });
  assert.deepEqual(values.artist, { text: 'Miles Davis' });
  assert.deepEqual(values.center, { text: '-20' });
  assert.deepEqual(values['audio-mode'], { text: 'NORMAL' });
  assert.equal(sourceLabel(entry, 'en'), 'Spotify');

  entry.nowPlaying = {
    ...entry.nowPlaying,
    contentSource: 'PRODUCT',
    contentAccount: 'TV',
    title: '',
  };
  assert.equal(sourceValue(entry), 'tv');
  assert.deepEqual(Object.fromEntries(featureValues(entry, 'fr')).title, { text: 'TV' });

  entry.nowPlaying = {
    ...entry.nowPlaying,
    contentSource: 'TUNEIN',
    contentAccount: '',
    location: '/v1/playback/station/s15200',
  };
  assert.equal(sourceValue(entry), 'preset-1');

  entry.on = false;
  const off = Object.fromEntries(featureValues(entry, 'es'));
  assert.equal(off.power, 0);
  assert.equal(off['playback-state'], 0);
  assert.deepEqual(off.title, { text: 'En espera' });
  assert.deepEqual(off.artist, { text: '—' }, 'Gladys ignores an empty text');

  const portable = Object.fromEntries(
    featureValues(entryOf({ soundbar: false, battery: true }), 'en'),
  );
  assert.equal(portable.battery, 64);
  assert.equal(portable.charging, 1);
});

test('commands: what each feature sends', () => {
  const entry = entryOf();
  assert.deepEqual(commandFor(entry, 'power', 0).body, { power: 'OFF' });
  assert.deepEqual(commandFor(entry, 'volume', 142.4).body, { value: 100 });
  assert.deepEqual(commandFor(entry, 'mute', 1).body, { muted: true });
  assert.deepEqual(commandFor(entry, 'next', 1).body, { state: 'SKIPNEXT' });
  assert.deepEqual(commandFor(entry, 'bass', '30'), {
    resource: '/audio/bass',
    method: 'POST',
    body: { value: 30 },
    applyAs: '/audio/bass',
  });
  assert.throws(() => commandFor(entry, 'bass', '300'), RangeError);
  assert.throws(() => commandFor(entry, 'midrange', '0'), RangeError, 'not on this speaker');
  assert.deepEqual(commandFor(entry, 'audio-mode', 'DIALOG').body, { value: 'DIALOG' });
  assert.throws(() => commandFor(entry, 'audio-mode', 'LOUD'), RangeError);
  assert.equal(sourceCommand(entry, 'other'), null, 'nothing to do');
  assert.deepEqual(sourceCommand(entry, 'optical').body, {
    source: 'PRODUCT',
    sourceAccount: 'AUX_DIGITAL',
  });
  const preset = sourceCommand(entry, 'preset-2', 'person-1');
  assert.equal(preset.body.initiatorID, 'person-1');
  assert.equal(preset.body.preset.location, 'spotify:playlist:jazz');
  assert.throws(() => sourceCommand(entry, 'preset-5'), RangeError);
});

test('configuration: defaults and bounds', () => {
  assert.deepEqual(normalizeConfig({}), {
    email: '',
    password: '',
    hosts: [],
    rescanMs: 3600000,
    language: 'en',
  });
  const config = normalizeConfig({
    email: ' jane@example.com ',
    password: ' secret ',
    hosts: '192.168.1.50, 192.168.1.51',
    rescan_interval: '0',
    language: 'es',
  });
  assert.equal(config.email, 'jane@example.com');
  assert.equal(config.password, ' secret ', 'a password is kept as typed');
  assert.deepEqual(config.hosts, ['192.168.1.50', '192.168.1.51']);
  assert.equal(config.rescanMs, 0);
  assert.equal(normalizeConfig({ rescan_interval: '7' }).rescanMs, 3600000);
});

test('state publication: coalesced, only created devices, paused on a 429', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const clock = fakeClock();
  const device = 'ext:test-integration:speaker:a1';
  const created = new Set([device]);
  const states = createStatePublisher(gladys, {
    logger: silentLogger,
    now: clock.now,
    isCreated: (id) => created.has(id),
  });
  states.push(`${device}:volume`, 20);
  states.push(`${device}:volume`, 19);
  states.push(`${device}:title`, { text: 'So What' });
  states.push('ext:test-integration:speaker:a2:power', 1);
  assert.equal(states.pendingCount(), 2, 'newest value only, created devices only');
  assert.equal(await states.flush(), 2);
  assert.equal(gladys.fake.lastState(`${device}:volume`), 19);

  const original = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = async () => {
    const error = new Error('Too many requests');
    error.status = 429;
    throw error;
  };
  states.push(`${device}:volume`, 18);
  assert.equal(await states.flush(), 0);
  gladys.publishChangedStates = original;
  assert.equal(await states.flush(), 0, 'paused');
  clock.advance(31000);
  assert.equal(await states.flush(), 1, 'sent after the pause');

  created.add('ext:test-integration:speaker:a2');
  states.republish('ext:test-integration:speaker:a2');
  assert.equal(await states.flush(), 1, 'the value known before the creation');
  states.stop();
});
