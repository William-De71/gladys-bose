// A fake Bose Music speaker: a real WebSocket server (package `ws`) on
// 127.0.0.1 that speaks the local protocol as documented by pybose:
//
//   - sub-protocol `eco2`, `?product=` in the URL;
//   - it speaks first after the connection: a NOTIFY carrying its GUID in
//     `header.device` (clients read the GUID there). Which resource that
//     first message is about is not documented: only the header matters;
//   - every REQUEST is checked: device = its GUID, a token of the right
//     account, msgtype, reqID; a wrong token gets a 401 RESPONSE with
//     `error: { code, message }`; `notBefore` refuses the first requests
//     with "JWT not before check failed" (a speaker whose clock is late);
//   - a resource it does not have gets no answer at all (the real speakers
//     stay silent), like a GET of an audio setting it lacks;
//   - after `PUT /subscription` (version 2), every change of state is pushed
//     as a NOTIFY to the subscribed clients.
//
// Bodies follow the shapes of the pybose response types. Groups live in the
// FakeBoseNetwork, shared by its speakers.

import { WebSocketServer } from 'ws';

const AUDIO = ['bass', 'midrange', 'treble', 'center', 'surround', 'height', 'subwooferGain'];

export class FakeSpeaker {
  /**
   * @param {object} options - Options.
   * @param {string} options.guid - GUID (as the speaker writes it).
   * @param {string} options.host - LAN address the integration knows it by.
   * @param {string} [options.name] - Name given in the Bose app.
   * @param {string} [options.product] - Model.
   * @param {boolean} [options.soundbar] - Centre, surround, height, dialogue modes, TV input.
   * @param {boolean} [options.battery] - Portable speaker.
   * @param {string[]} [options.unlisted] - Audio settings it has without listing them.
   */
  constructor({
    guid,
    host,
    name = 'Salon',
    product = 'Bose Smart Soundbar',
    soundbar = true,
    battery = false,
    unlisted = [],
  }) {
    Object.assign(this, { guid, host, name, product, soundbar, hasBattery: battery });
    // The access token of the account it belongs to (set by the tests).
    this.token = null;
    this.notBefore = 0;
    this.power = 'ON';
    this.volume = { value: 30, muted: false };
    this.audio = { bass: 0, treble: 10 };
    if (soundbar) {
      Object.assign(this.audio, { center: -20, surround: 0, height: 0 });
    }
    this.unlisted = unlisted;
    for (const key of unlisted) {
      this.audio[key] ??= 0;
    }
    this.mode = 'NORMAL';
    this.battery = { percent: 64, chargeStatus: 'DISCHARGING', minutesToEmpty: 433 };
    this.playing = {
      status: 'PLAY',
      source: 'SPOTIFY',
      sourceName: 'Spotify',
      account: 'SpotifyConnectUserName',
      title: 'So What',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      art: 'https://i.scdn.co/image/kind-of-blue',
      location: '',
    };
    this.presets = {
      1: { name: 'FIP', source: 'TUNEIN', account: '', location: '/v1/playback/station/s15200' },
      2: { name: 'Jazz', source: 'SPOTIFY', account: 'user', location: 'spotify:playlist:jazz' },
    };
    this.requests = [];
    this.clients = new Set();
    this.network = null;
  }

  // --- Bodies, as the speaker writes them -------------------------------------------

  capabilities() {
    const endpoints = [
      '/system/info',
      '/system/power/control',
      '/audio/volume',
      '/content/nowPlaying',
      '/content/transportControl',
      '/content/playbackRequest',
      '/system/sources',
      '/system/productSettings',
      '/grouping/activeGroups',
      ...Object.keys(this.audio)
        .filter((key) => !this.unlisted.includes(key))
        .map((key) => `/audio/${key}`),
    ];
    if (this.soundbar) {
      endpoints.push('/audio/mode');
    }
    if (this.hasBattery) {
      endpoints.push('/system/battery');
    }
    return {
      group: [
        {
          apiGroup: 'ProductController',
          version: 1,
          endpoints: endpoints.map((endpoint) => ({ endpoint })),
        },
      ],
    };
  }

  systemInfo() {
    return {
      countryCode: 'FR',
      defaultName: 'Bose Smart Soundbar',
      limitedFeatures: false,
      name: this.name,
      productColor: 1,
      productId: 16489,
      productName: this.product,
      productType: 'stetson',
      regionCode: 'GB',
      serialNumber: `SN-${this.guid}`,
      softwareVersion: '23.2.6-123+abcdef',
      variantId: 1,
    };
  }

  nowPlaying() {
    const playing = this.playing;
    if (this.power !== 'ON') {
      return { collectData: true, state: { status: 'STOPPED' } };
    }
    const product = playing.source === 'PRODUCT';
    return {
      collectData: true,
      container: {
        contentItem: {
          isLocal: product,
          presetable: !product,
          source: playing.source,
          sourceAccount: playing.account,
          ...(playing.location ? { location: playing.location } : {}),
        },
      },
      source: { sourceDisplayName: playing.sourceName, sourceID: playing.source },
      metadata: product
        ? {}
        : { album: playing.album, artist: playing.artist, duration: 562, trackName: playing.title },
      state: { status: playing.status, timeIntoTrack: 12, canPause: true },
      track: product ? {} : { contentItem: { containerArt: playing.art } },
    };
  }

  sources() {
    const list = [
      {
        sourceName: 'SPOTIFY',
        sourceAccountName: 'SpotifyConnectUserName',
        status: 'AVAILABLE',
        visible: true,
      },
      { sourceName: 'BLUETOOTH', sourceAccountName: '', status: 'AVAILABLE', visible: true },
    ];
    if (this.soundbar) {
      list.push(
        { sourceName: 'PRODUCT', sourceAccountName: 'TV', status: 'UNAVAILABLE', visible: true },
        {
          sourceName: 'PRODUCT',
          sourceAccountName: 'AUX_DIGITAL',
          status: 'NOT_CONFIGURED',
          visible: true,
        },
        {
          sourceName: 'PRODUCT',
          sourceAccountName: 'AUX_ANALOG',
          status: 'UNAVAILABLE',
          visible: false,
        },
      );
    }
    return { properties: {}, sources: list };
  }

  productSettings() {
    const presets = {};
    for (const [id, preset] of Object.entries(this.presets)) {
      presets[id] = {
        actions: [
          {
            actionType: 'PLAYBACK',
            metadata: { accountID: preset.account, image: '', name: preset.name, subType: '' },
            payload: {
              contentItem: {
                containerArt: `https://cdn.example/${id}.png`,
                location: preset.location,
                name: preset.name,
                presetable: true,
                source: preset.source,
                sourceAccount: preset.account,
                type: 'stationurl',
              },
            },
          },
        ],
      };
    }
    return {
      language: 'fr',
      presets: { presets },
      productName: this.name,
      timezone: 'Europe/Paris',
    };
  }

  audioBody(key) {
    return {
      persistence: true,
      properties: { max: 100, min: -100, step: 10, supportedPersistence: true },
      value: this.audio[key],
    };
  }

  modeBody() {
    return {
      persistence: 'SESSION',
      properties: { supportedPersistence: ['SESSION'], supportedValues: ['NORMAL', 'DIALOG'] },
      value: this.mode,
    };
  }

  // --- Requests ------------------------------------------------------------------------

  /** The body of the answer, `undefined` for silence, `{ error }` for a refusal. */
  handle(method, resource, body) {
    const key = resource.replace('/audio/', '');
    switch (`${method} ${resource}`) {
      case 'GET /system/capabilities':
        return this.capabilities();
      case 'GET /system/info':
        return this.systemInfo();
      case 'PUT /subscription':
        return {};
      case 'GET /system/power/control':
        return { power: this.power };
      case 'POST /system/power/control':
        this.power = body.power === 'ON' ? 'ON' : 'NETWORK_STANDBY';
        this.push('/system/power/control', { power: this.power });
        this.push('/content/nowPlaying', this.nowPlaying());
        // The real speaker answers this one with an empty body.
        return {};
      case 'GET /audio/volume':
      case 'PUT /audio/volume': {
        if (method === 'PUT') {
          if (Number.isInteger(body.value)) {
            this.volume.value = body.value;
          }
          if (typeof body.muted === 'boolean') {
            this.volume.muted = body.muted;
          }
          this.push('/audio/volume', this.volumeBody());
        }
        return this.volumeBody();
      }
      case 'GET /content/nowPlaying':
        return this.nowPlaying();
      case 'PUT /content/transportControl': {
        const next = { PLAY: 'PLAY', PAUSE: 'PAUSED' }[body.state];
        if (next) {
          this.playing.status = next;
        } else if (body.state === 'SKIPNEXT') {
          this.playing.title = 'Freddie Freeloader';
        } else if (body.state === 'SKIPPREVIOUS') {
          this.playing.title = 'So What';
        }
        this.push('/content/nowPlaying', this.nowPlaying());
        return this.nowPlaying();
      }
      case 'POST /content/playbackRequest': {
        this.power = 'ON';
        if (body.preset) {
          this.playing = {
            status: 'PLAY',
            source: body.source,
            sourceName: body.source === 'TUNEIN' ? 'TuneIn' : 'Spotify',
            account: body.sourceAccount,
            title: body.preset.name,
            artist: '',
            album: '',
            art: body.preset.containerArt,
            location: body.preset.location,
          };
          this.lastInitiator = body.initiatorID;
        } else {
          this.playing = {
            ...this.playing,
            status: 'PLAY',
            source: body.source,
            sourceName: body.source === 'PRODUCT' ? 'TV' : body.source,
            account: body.sourceAccount,
            location: '',
          };
        }
        this.push('/content/nowPlaying', this.nowPlaying());
        return this.nowPlaying();
      }
      case 'GET /system/sources':
        return this.sources();
      case 'GET /system/productSettings':
        return this.productSettings();
      case 'GET /audio/mode':
        return this.soundbar ? this.modeBody() : undefined;
      case 'POST /audio/mode':
        if (!this.soundbar) {
          return undefined;
        }
        this.mode = body.value;
        this.push('/audio/mode', this.modeBody());
        return { value: this.mode };
      case 'GET /system/battery':
        return this.hasBattery ? this.battery : undefined;
      case 'GET /grouping/activeGroups':
        return this.network.groupsOf(this);
      case 'POST /grouping/activeGroups':
        return this.network.createGroup(this, body);
      case 'PUT /grouping/activeGroups':
        return this.network.changeGroup(this, body);
      case 'DELETE /grouping/activeGroups':
        return this.network.stopGroup(this);
      default:
        if (resource.startsWith('/audio/') && AUDIO.includes(key) && key in this.audio) {
          if (method === 'POST') {
            this.audio[key] = body.value;
            this.push(resource, this.audioBody(key));
          }
          return this.audioBody(key);
        }
        // Unknown to this speaker: silence.
        return undefined;
    }
  }

  volumeBody() {
    return { defaultOn: 30, max: 100, min: 10, muted: this.volume.muted, value: this.volume.value };
  }

  /** Push a change to the subscribed clients. */
  push(resource, body) {
    for (const client of this.clients) {
      if (client.subscribed) {
        client.socket.send(
          JSON.stringify({
            header: {
              device: this.guid,
              resource,
              msgtype: 'NOTIFY',
              method: 'NOTIFY',
              version: 1,
              status: 200,
            },
            body,
          }),
        );
      }
    }
  }

  receive(client, raw) {
    const message = JSON.parse(String(raw));
    const header = message.header ?? {};
    this.requests.push({
      method: header.method,
      resource: header.resource,
      body: message.body,
      header,
    });
    const answer = (status, body, error) =>
      client.socket.send(
        JSON.stringify({
          header: {
            device: this.guid,
            method: header.method,
            msgtype: 'RESPONSE',
            reqID: header.reqID,
            resource: header.resource,
            status,
            version: header.version,
          },
          body: body ?? {},
          ...(error ? { error } : {}),
        }),
      );
    if (
      header.msgtype !== 'REQUEST' ||
      header.device !== this.guid ||
      !Number.isInteger(header.reqID)
    ) {
      answer(400, {}, { code: 400, message: 'Bad request' });
      return;
    }
    if (header.token !== this.token) {
      answer(401, {}, { code: 401, message: 'Invalid token' });
      return;
    }
    if (this.notBefore > 0) {
      this.notBefore -= 1;
      answer(401, {}, { code: 4012, message: 'JWT not before check failed' });
      return;
    }
    if (header.resource === '/subscription') {
      client.subscribed = header.version === 2;
    }
    const body = this.handle(header.method, header.resource, message.body ?? {});
    if (body !== undefined) {
      answer(200, body);
    }
  }
}

/** Fake speakers on 127.0.0.1, each on its own port, plus their groups. */
export class FakeBoseNetwork {
  constructor(speakers) {
    this.speakers = speakers;
    this.servers = new Map(); // host -> { server, port }
    this.groups = []; // { activeGroupId, groupMasterId, products }
    this.connections = 0;
    speakers.forEach((speaker) => (speaker.network = this));
  }

  async start() {
    await Promise.all(this.speakers.map((speaker) => this.listen(speaker)));
    return this;
  }

  listen(speaker) {
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        handleProtocols: (protocols) => (protocols.has('eco2') ? 'eco2' : false),
      });
      server.on('connection', (socket, request) => {
        this.connections += 1;
        const client = { socket, subscribed: false, url: request.url };
        speaker.clients.add(client);
        socket.on('message', (raw) => speaker.receive(client, raw));
        socket.on('close', () => speaker.clients.delete(client));
        // The speaker speaks first: its GUID in the header.
        socket.send(
          JSON.stringify({
            header: {
              device: speaker.guid,
              resource: '/connectionInfo',
              msgtype: 'NOTIFY',
              version: 1,
              status: 200,
            },
            body: {},
          }),
        );
      });
      server.on('listening', () => {
        this.servers.set(speaker.host, { server, port: server.address().port });
        resolve();
      });
    });
  }

  portOf(host) {
    return this.servers.get(host)?.port;
  }

  /** Unplug a speaker: close its clients and stop listening. */
  async unplug(speaker) {
    const entry = this.servers.get(speaker.host);
    for (const client of speaker.clients) {
      client.socket.terminate();
    }
    if (entry) {
      await new Promise((resolve) => entry.server.close(resolve));
      this.servers.delete(speaker.host);
    }
  }

  async plug(speaker) {
    await this.listen(speaker);
  }

  /** The mDNS answers of the speakers, as the Gladys core relays them. */
  mdns() {
    return this.speakers
      .filter((speaker) => this.servers.has(speaker.host))
      .map((speaker) => ({
        name: `${speaker.name}._bose-passport._tcp.local`,
        host: `${speaker.guid}.local`,
        addresses: [speaker.host, 'fe80::1'],
        port: 8280,
        txt: [`GUID=${speaker.guid}`, 'MAC=AABBCCDDEEFF', 'PRODUCT=Madrid'],
      }));
  }

  groupOf(speaker) {
    return this.groups.find((group) =>
      group.products.some((product) => product.productId === speaker.guid),
    );
  }

  groupsOf(speaker) {
    const group = this.groupOf(speaker);
    return { activeGroups: group ? [group] : [] };
  }

  notifyGroup(guids) {
    for (const speaker of this.speakers) {
      if (guids.includes(speaker.guid)) {
        speaker.push('/grouping/activeGroups', this.groupsOf(speaker));
      }
    }
  }

  createGroup(master, body) {
    const products = body.products ?? [];
    const group = {
      activeGroupId: `group-${this.groups.length + 1}`,
      groupMasterId: master.guid,
      name: '',
      productStates: products.map((product) => ({
        productId: product.productId,
        status: 'MASTER',
      })),
      products,
    };
    this.groups.push(group);
    this.notifyGroup(products.map((product) => product.productId));
    return {};
  }

  changeGroup(master, body) {
    const group = this.groups.find((candidate) => candidate.activeGroupId === body.activeGroupId);
    if (!group || group.groupMasterId !== master.guid) {
      return undefined;
    }
    const touched = group.products.map((product) => product.productId);
    group.products = [
      ...group.products.filter(
        (product) =>
          !(body.removeProducts ?? []).some((removed) => removed.productId === product.productId),
      ),
      ...(body.addProducts ?? []),
    ];
    touched.push(...(body.addProducts ?? []).map((product) => product.productId));
    if (group.products.length < 2) {
      this.groups = this.groups.filter((candidate) => candidate !== group);
    }
    this.notifyGroup(touched);
    return {};
  }

  stopGroup(master) {
    const group = this.groupOf(master);
    if (group) {
      this.groups = this.groups.filter((candidate) => candidate !== group);
      this.notifyGroup(group.products.map((product) => product.productId));
    }
    return {};
  }

  async stop() {
    await Promise.all(this.speakers.map((speaker) => this.unplug(speaker)));
  }
}
