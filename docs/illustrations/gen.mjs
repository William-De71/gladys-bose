// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK, the fake Bose cloud and the fake speakers of the tests (real local
// WebSockets), on a made-up evening: the living room soundbar plays an album
// and leads a group, the portable speaker in the kitchen is paused.
// The cover is drawn here (an SVG square): it stands for the image a music
// service serves.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { createArtStore } = await load('src/art.js');
const { createBoseAuth } = await load('src/bose/auth.js');
const { LANGUAGES } = await load('src/i18n.js');
const { memoryStorage } = await load('src/storage.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { EMAIL, PASSWORD, PNG, fakeWorld, FakeSpeaker, until } = await load('test/helpers.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

const NAMES = {
  salon: { en: 'Living room', fr: 'Salon', de: 'Wohnzimmer', es: 'Salón' },
  kitchen: { en: 'Kitchen', fr: 'Cuisine', de: 'Küche', es: 'Cocina' },
};
const SALON = '3c4fa1b2-5e6d-4f70-8a9b-0c1d2e3f4a5b';
const KITCHEN = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

const cover = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f3a5f"/><stop offset="1" stop-color="#4a90c2"/></linearGradient></defs>` +
    `<rect width="640" height="640" fill="url(#g)"/><circle cx="320" cy="320" r="170" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="10"/>` +
    `<circle cx="320" cy="320" r="34" fill="#fff" fill-opacity=".8"/>` +
    `<text x="320" y="600" font-family="Arial, sans-serif" font-size="44" fill="#fff" text-anchor="middle">Kind of Blue</text></svg>`,
).toString('base64')}`;

/**
 * @description One language: the soundbar playing, the portable paused.
 * @param {string} language - Language.
 * @returns {Promise<{ contents: object, images: object }>} The widget contents and their images.
 */
async function contents(language) {
  const salon = new FakeSpeaker({ guid: SALON, host: '192.168.1.50', name: NAMES.salon[language] });
  salon.volume.value = 35;
  const kitchen = new FakeSpeaker({
    guid: KITCHEN,
    host: '192.168.1.51',
    name: NAMES.kitchen[language],
    product: 'Bose Portable Smart Speaker',
    soundbar: false,
    battery: true,
  });
  kitchen.playing = {
    ...kitchen.playing,
    status: 'PAUSED',
    source: 'BLUETOOTH',
    sourceName: 'Bluetooth',
    title: 'Blue in Green',
    art: '',
  };
  kitchen.battery = { percent: 72, chargeStatus: 'DISCHARGING' };
  const world = await fakeWorld([salon, kitchen]);
  const gladys = createFakeGladys({ config: { email: EMAIL, password: PASSWORD, language } });
  gladys.scanNetwork = async () => world.network.mdns();
  const app = createApp(gladys, {
    auth: createBoseAuth({ fetch: world.cloud.fetch }),
    connect: world.connect,
    art: createArtStore({ fetch: async () => new Response(PNG, { status: 200 }) }),
    storage: memoryStorage(),
    logger: silent,
    timings: { probeTimeoutMs: 100 },
  });
  await gladys.connect();
  await app.start();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
  await until(() => [...app.hub.entries.values()].every((entry) => entry.reachable && entry.conn));
  const ids = Object.fromEntries(
    gladys.fake.discoveredDevices.map((device) => [
      device.external_id.split(':').pop(),
      device.external_id,
    ]),
  );
  await gladys.fake.sceneAction('group_speakers', { leader: ids[SALON], members: [ids[KITCHEN]] });
  await until(() => app.hub.entries.get(SALON).group !== null);

  const get = async (device) =>
    (await gladys.fake.widgetGet('now_playing', { settings: { device }, language })).data.content;
  const playing = await get(ids[SALON]);
  await app.stop();
  await world.stop();

  // A portable speaker on its own, paused (a second, ungrouped world).
  const alone = new FakeSpeaker({
    guid: KITCHEN,
    host: '192.168.1.51',
    name: NAMES.kitchen[language],
    product: 'Bose Portable Smart Speaker',
    soundbar: false,
    battery: true,
  });
  alone.playing = kitchen.playing;
  alone.battery = kitchen.battery;
  alone.volume.value = 22;
  const second = await fakeWorld([alone]);
  const gladys2 = createFakeGladys({ config: { email: EMAIL, password: PASSWORD, language } });
  gladys2.scanNetwork = async () => second.network.mdns();
  const app2 = createApp(gladys2, {
    auth: createBoseAuth({ fetch: second.cloud.fetch }),
    connect: second.connect,
    storage: memoryStorage(),
    logger: silent,
    timings: { probeTimeoutMs: 100 },
  });
  await gladys2.connect();
  await app2.start();
  for (const device of gladys2.fake.discoveredDevices) {
    await gladys2.fake.deviceCreated(structuredClone(device));
  }
  await until(() => [...app2.hub.entries.values()].every((entry) => entry.reachable && entry.conn));
  const paused = (
    await gladys2.fake.widgetGet('now_playing', {
      settings: { device: gladys2.fake.discoveredDevices[0].external_id },
      language,
    })
  ).data.content;
  await app2.stop();
  await second.stop();

  // The cover key hashes the served bytes: draw a cover instead.
  const images = {};
  const image = playing.components.find((component) => component.type === 'image');
  image.key = 'illustration-cover';
  images[image.key] = cover;
  return { contents: { now_playing: playing, now_playing_paused: paused }, images };
}

const all = {};
const images = {};
for (const language of LANGUAGES) {
  const result = await contents(language);
  all[language] = result.contents;
  Object.assign(images, result.images);
}

const widget = manifest.widgets.find((item) => item.key === 'now_playing');
const card = { icon: widget.icon, label: widget.label };
writeFileSync(
  out,
  JSON.stringify({ contents: all, images, cards: { now_playing: card, now_playing_paused: card } }),
);
