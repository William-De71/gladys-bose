// The manifest and the code agree: every declared action, widget, trigger and
// configuration key has its code, every version says the same thing, and the
// manifest respects what the store and the Gladys core expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS } from '../src/app.js';
import { MDNS_SERVICE } from '../src/bose/discovery.js';
import { DEFAULTS, LANGUAGES, RESCAN_INTERVALS } from '../src/config.js';
import {
  PRESET_NUMBERS,
  SCENE_ACTION_OUTPUTS,
  SCENE_ACTIONS,
  SCENE_TRIGGER_DATA,
  SCENE_TRIGGERS,
  SOURCE_FILTER_VALUES,
} from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));

test('one version everywhere, image of this repository', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-bose:${pkg.version}`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/William-De71\/gladys-bose\/main\/cover\.jpg$/,
  );
});

test('store rules: type, Gladys version, transports, categories, permissions', () => {
  assert.equal(manifest.type, 'device');
  // widgets and scene_* need 5.1.0; no widget form, no houses source.
  assert.equal(manifest.gladys_version, '>=5.1.0');
  // Commands and states stay on the local network; the Bose cloud only
  // gives the account token (README "Transport").
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.equal(manifest.name, 'Bose');
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  for (const key of ['location', 'containers', 'webhooks', 'network_wake']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('configuration: keys, defaults and choices of the code, the password a secret', () => {
  const fields = byKey(manifest.config_schema);
  const values = (field) => field.options.map((option) => option.value);
  assert.deepEqual(values(fields.language), LANGUAGES);
  assert.deepEqual(values(fields.rescan_interval), RESCAN_INTERVALS.map(String));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.equal(fields.email.type, 'string');
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.default, undefined);
  // `text` / `password` are refused by the store.
  for (const field of manifest.config_schema) {
    assert.ok(['string', 'secret', 'select', 'section'].includes(field.type), field.key);
  }
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined, 'one transport: no local preference');
});

test('configuration buttons: the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
});

test('scene triggers: keys, filters and variables of the code', () => {
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(Object.keys(triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    const declared = new Set([
      ...trigger.fields.map((field) => field.key),
      ...trigger.variables.map((variable) => variable.key),
    ]);
    assert.deepEqual(
      [...declared].sort(),
      [...SCENE_TRIGGER_DATA[trigger.key]].sort(),
      trigger.key,
    );
    const device = byKey(trigger.fields).device;
    assert.equal(device.source, 'devices');
    assert.notEqual(device.required, true, 'empty: any speaker');
  }
  assert.deepEqual(
    byKey(triggers.source_changed.fields).source.options.map((option) => option.value),
    SOURCE_FILTER_VALUES,
  );
});

test('scene actions: keys, fields, options and outputs of the code', () => {
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(Object.keys(actions).sort(), Object.values(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.deepEqual(
      (action.outputs ?? []).map((output) => output.key),
      SCENE_ACTION_OUTPUTS[action.key],
      action.key,
    );
    for (const field of action.fields) {
      if (field.source) {
        assert.equal(field.source, 'devices');
        assert.equal(field.required, true);
      }
    }
  }
  assert.deepEqual(
    byKey(actions.play_preset.fields).preset.options.map((option) => option.value),
    PRESET_NUMBERS,
  );
  assert.equal(byKey(actions.group_speakers.fields).members.type, 'multi_select');
});

test('widgets: the keys of the code, settings without secrets', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  const widget = byKey(manifest.widgets).now_playing;
  assert.equal(byKey(widget.settings).device.source, 'devices');
  for (const item of manifest.widgets) {
    for (const setting of item.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
});
