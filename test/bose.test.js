// The protocol layer against fakes that check what the real services check:
// the WebSocket client (src/bose/connection.js) against fake speakers on
// real local sockets, plain and TLS; the sign-in (src/bose/auth.js) and the
// token manager (src/account.js) against the fake Bose cloud; the parsers
// (src/bose/model.js) on the bodies of the pybose types.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';

import { ACCOUNT_STATUS, createAccount } from '../src/account.js';
import {
  AuthRejectedError,
  AuthUnavailableError,
  createBoseAuth,
  findCsrf,
  findTransaction,
  pkcePair,
  tokenExpiry,
} from '../src/bose/auth.js';
import { CLIENT_ID, openConnection, SUBPROTOCOL } from '../src/bose/connection.js';
import { mdnsSpeakers, normalizeGuid, parseHosts } from '../src/bose/discovery.js';
import {
  parseAudioMode,
  parseAudioSetting,
  parseBattery,
  parseCapabilities,
  parseGroup,
  parseNowPlaying,
  parsePower,
  parsePresets,
  parseSources,
  parseVolume,
  selectableInputs,
} from '../src/bose/model.js';
import { memoryStorage } from '../src/storage.js';
import {
  EMAIL,
  FakeBoseCloud,
  fakeClock,
  fakeWorld,
  FakeSpeaker,
  jwt,
  PASSWORD,
  SALON_GUID,
  silentLogger,
  until,
} from './helpers.js';

const speaker = (options = {}) =>
  new FakeSpeaker({ guid: SALON_GUID, host: '192.168.1.50', ...options });

// --- WebSocket client -----------------------------------------------------------------

test('connection: GUID from the first message, token in every request, answers by reqID', async () => {
  const salon = speaker();
  salon.token = 'token-1';
  const world = await fakeWorld([salon]);
  try {
    const conn = await world.connect({ host: '192.168.1.50', getToken: async () => 'token-1' });
    assert.equal(await conn.waitForGuid(), SALON_GUID);
    const [capabilities, info] = await Promise.all([
      conn.request('/system/capabilities'),
      conn.request('/system/info'),
    ]);
    assert.ok(parseCapabilities(capabilities).has('/audio/volume'));
    assert.equal(info.name, 'Salon');
    const sent = salon.requests[0].header;
    assert.deepEqual(
      { ...sent, reqID: undefined },
      {
        device: SALON_GUID,
        method: 'GET',
        msgtype: 'REQUEST',
        reqID: undefined,
        resource: '/system/capabilities',
        status: 200,
        token: 'token-1',
        version: 1,
      },
    );
    const [client] = salon.clients;
    assert.equal(client.socket.protocol, SUBPROTOCOL);
    assert.equal(client.url, `/?product=${CLIENT_ID}`);
    conn.close();
  } finally {
    await world.stop();
  }
});

test('connection: notifications after the subscription, refusals, silence, lost connection', async () => {
  const salon = speaker();
  salon.token = 'token-1';
  const world = await fakeWorld([salon]);
  const notified = [];
  let closed = null;
  try {
    const conn = await world.connect({
      host: '192.168.1.50',
      getToken: async () => 'token-1',
      onNotify: (resource, body) => notified.push([resource, body]),
      onClose: (error) => (closed = error),
    });
    await conn.request(
      '/subscription',
      'PUT',
      { notifications: [{ resource: '/audio/volume', version: 1 }] },
      { version: 2 },
    );
    await conn.request('/audio/volume', 'PUT', { value: 42 });
    await until(() => notified.some(([resource]) => resource === '/audio/volume'));
    assert.equal(notified.find(([resource]) => resource === '/audio/volume')[1].value, 42);

    // A resource the speaker does not have: no answer at all, a timeout.
    await assert.rejects(conn.request('/audio/midrange'), { kind: 'timeout', status: 408 });

    // A wrong token: refused with the error of the speaker, never retried.
    salon.token = 'another';
    await assert.rejects(conn.request('/system/info'), {
      kind: 'speaker',
      status: 401,
      message: 'Invalid token',
    });

    await world.network.unplug(salon);
    await until(() => closed !== null);
    assert.equal(closed.kind, 'closed');
    assert.equal(conn.isOpen(), false);
    await assert.rejects(conn.request('/system/info'), { kind: 'closed' });
  } finally {
    await world.stop();
  }
});

test('connection: a fresh token "not before" the clock of the speaker is tried again', async () => {
  const salon = speaker();
  salon.token = 'token-1';
  salon.notBefore = 2;
  const world = await fakeWorld([salon]);
  try {
    const conn = await world.connect({
      host: '192.168.1.50',
      getToken: async () => 'token-1',
      sleep: async () => {},
    });
    const info = await conn.request('/system/info');
    assert.equal(info.name, 'Salon');
    assert.equal(salon.requests.length, 3, 'two refusals, then the answer');
    salon.notBefore = 10;
    await assert.rejects(conn.request('/system/info'), { status: 401 });
    conn.close();
  } finally {
    await world.stop();
  }
});

test('connection: nothing listening, a connection error', async () => {
  await assert.rejects(
    openConnection({ host: '127.0.0.1', port: 9, secure: false, getToken: async () => 't' }),
    { kind: 'connect' },
  );
});

let openssl = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  openssl = false;
}

test(
  'connection: wss with the self-signed certificate of the speaker',
  { skip: !openssl && 'openssl missing' },
  async () => {
    // A throwaway self-signed certificate, made for this test only.
    const dir = mkdtempSync(join(tmpdir(), 'gladys-bose-tls-'));
    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-subj',
          '/CN=bose-speaker',
          '-days',
          '1',
          '-keyout',
          join(dir, 'key.pem'),
          '-out',
          join(dir, 'cert.pem'),
        ],
        { stdio: 'ignore' },
      );
      const server = createServer({
        key: readFileSync(join(dir, 'key.pem')),
        cert: readFileSync(join(dir, 'cert.pem')),
      });
      const wss = new WebSocketServer({ server, handleProtocols: () => SUBPROTOCOL });
      wss.on('connection', (socket) => {
        socket.send(JSON.stringify({ header: { device: SALON_GUID, msgtype: 'NOTIFY' } }));
        socket.on('message', (raw) => {
          const { header } = JSON.parse(String(raw));
          socket.send(
            JSON.stringify({
              header: { ...header, msgtype: 'RESPONSE', status: 200 },
              body: { power: 'ON' },
            }),
          );
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const conn = await openConnection({
        host: '127.0.0.1',
        port: server.address().port,
        getToken: async () => 't',
      });
      assert.deepEqual(await conn.request('/system/power/control'), { power: 'ON' });
      conn.close();
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// --- Sign-in -----------------------------------------------------------------------

test('sign-in: the whole B2C flow, then the Bose token exchange', async () => {
  const cloud = new FakeBoseCloud();
  const auth = createBoseAuth({ fetch: cloud.fetch });
  const tokens = await auth.login(EMAIL, PASSWORD);
  assert.equal(tokens.accessToken, cloud.accessToken);
  assert.equal(tokens.personId, 'person-1');
  assert.ok(tokens.expiresAt > Date.now() + 23 * 3600 * 1000);
  assert.match(tokens.azureRefreshToken, /^azure-refresh-/);
  assert.equal(cloud.logins, 1);
  // The password is only sent to the B2C password step.
  const withPassword = cloud.calls.filter((call) => call.body.includes('battery'));
  assert.equal(withPassword.length, 1);
  assert.match(withPassword[0].url, /\/B2C_1A_MBI_SUSI\/SelfAsserted\?/);
});

test('sign-in: refusals and outages are told apart', async () => {
  const cloud = new FakeBoseCloud();
  const auth = createBoseAuth({ fetch: cloud.fetch });
  await assert.rejects(auth.login(EMAIL, 'wrong'), AuthRejectedError);
  await assert.rejects(auth.login('nobody@example.com', PASSWORD), AuthRejectedError);
  cloud.down = true;
  await assert.rejects(auth.login(EMAIL, PASSWORD), AuthUnavailableError);
  cloud.down = false;
  await assert.rejects(auth.refresh('unknown'), AuthRejectedError);
  await assert.rejects(auth.refresh(''), AuthRejectedError);
});

test('sign-in: a refresh rotates the Azure token and gives a new Bose token', async () => {
  const cloud = new FakeBoseCloud();
  const auth = createBoseAuth({ fetch: cloud.fetch });
  const first = await auth.login(EMAIL, PASSWORD);
  const second = await auth.refresh(first.azureRefreshToken);
  assert.notEqual(second.accessToken, first.accessToken);
  assert.notEqual(second.azureRefreshToken, first.azureRefreshToken);
  await assert.rejects(auth.refresh(first.azureRefreshToken), AuthRejectedError, 'used once');
});

test('sign-in helpers: PKCE, JWT expiry, CSRF and transaction of a page', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenExpiry(jwt(2000000000)), 2000000000 * 1000);
  assert.equal(tokenExpiry('not a jwt'), 0);
  const html = '<script>var SETTINGS = {"csrf":"abc==","transId":"StateProperties=eyJ"};</script>';
  assert.equal(findCsrf(html), 'abc==');
  assert.equal(findCsrf('', new Map([['x-ms-cpim-csrf', 'fromcookie']])), 'fromcookie');
  assert.equal(findTransaction(html), 'StateProperties=eyJ');
  assert.equal(
    findTransaction('https://x/SelfAsserted?tx=StateProperties%3DeyJ1&p=B2C'),
    'StateProperties=eyJ1',
  );
  assert.equal(findTransaction('…StateProperties=eyJ2"'), 'StateProperties=eyJ2');
  assert.equal(findTransaction('nothing'), '');
});

// --- Token manager --------------------------------------------------------------------

const capture = () => {
  const lines = [];
  const log = (line) => lines.push(String(line));
  return { lines, logger: { debug: log, info: log, warn: log, error: log } };
};

test('account: signs in once, keeps the token in /data, refreshes it before it expires', async () => {
  const clock = fakeClock(Date.now());
  const cloud = new FakeBoseCloud({ now: clock.now });
  const storage = memoryStorage();
  const { lines, logger } = capture();
  const account = createAccount({
    auth: createBoseAuth({ fetch: cloud.fetch }),
    storage,
    logger,
    now: clock.now,
  });
  account.configure(EMAIL, PASSWORD);
  await account.start();
  assert.equal(account.status(), ACCOUNT_STATUS.OK);
  assert.equal(await account.token(), cloud.accessToken);
  assert.equal(account.personId(), 'person-1');
  const saved = storage.files['account.json'];
  assert.equal(saved.accessToken, cloud.accessToken);
  assert.ok(!JSON.stringify(saved).includes(PASSWORD), 'never the password');
  assert.ok(!JSON.stringify(saved).includes(EMAIL), 'the e-mail only as a fingerprint');

  // A restart reuses the saved token: no new sign-in.
  const again = createAccount({
    auth: createBoseAuth({ fetch: cloud.fetch }),
    storage,
    logger,
    now: clock.now,
  });
  again.configure(EMAIL, PASSWORD);
  await again.start();
  assert.equal(cloud.logins, 1);
  assert.equal(await again.token(), saved.accessToken);

  // Less than two hours left: refreshed, not signed in again.
  clock.advance(23 * 3600 * 1000);
  await again.renew({ force: false });
  assert.equal(cloud.refreshes, 1);
  assert.equal(cloud.logins, 1);
  assert.equal(await again.token(), cloud.accessToken);

  // A revoked refresh token: a full sign-in.
  cloud.refreshTokens.clear();
  await again.renew();
  assert.equal(cloud.logins, 2);

  account.stop();
  again.stop();
  for (const line of lines) {
    assert.ok(!line.includes(PASSWORD) && !line.includes(cloud.accessToken), line);
  }
});

test('account: a refused password is not tried again until the configuration changes', async () => {
  const cloud = new FakeBoseCloud();
  const statuses = [];
  const account = createAccount({
    auth: createBoseAuth({ fetch: cloud.fetch }),
    storage: memoryStorage(),
    logger: silentLogger,
    onChange: (status) => statuses.push(status),
  });
  account.configure(EMAIL, 'wrong');
  await account.start();
  assert.equal(account.status(), ACCOUNT_STATUS.REJECTED);
  const calls = cloud.calls.length;
  await account.renew();
  await assert.rejects(account.token(), { kind: 'token' });
  assert.equal(cloud.calls.length, calls, 'no new attempt');
  assert.equal(account.configure(EMAIL, 'wrong'), false, 'unchanged');
  assert.equal(account.configure(EMAIL, PASSWORD), true);
  await account.renew();
  assert.equal(account.status(), ACCOUNT_STATUS.OK);
  assert.deepEqual(statuses, ['rejected', 'missing', 'ok']);
  account.stop();
});

test('account: an outage keeps a valid token, without one the status says so', async () => {
  const clock = fakeClock(Date.now());
  const cloud = new FakeBoseCloud({ now: clock.now });
  const account = createAccount({
    auth: createBoseAuth({ fetch: cloud.fetch }),
    storage: memoryStorage(),
    logger: silentLogger,
    now: clock.now,
  });
  account.configure(EMAIL, PASSWORD);
  cloud.down = true;
  await account.start();
  assert.equal(account.status(), ACCOUNT_STATUS.UNAVAILABLE);
  cloud.down = false;
  // Retried after two minutes, not before.
  await account.renew({ force: false });
  assert.equal(cloud.logins, 0);
  clock.advance(2 * 60 * 1000 + 1);
  await account.renew({ force: false });
  assert.equal(account.status(), ACCOUNT_STATUS.OK);
  account.stop();
});

test('account: no credentials, no token, nothing sent', async () => {
  const cloud = new FakeBoseCloud();
  const account = createAccount({
    auth: createBoseAuth({ fetch: cloud.fetch }),
    storage: memoryStorage(),
    logger: silentLogger,
  });
  await account.start();
  assert.equal(account.status(), ACCOUNT_STATUS.MISSING);
  await assert.rejects(account.token(), { kind: 'token' });
  assert.equal(cloud.calls.length, 0);
  account.stop();
});

// --- Discovery and parsers ---------------------------------------------------------------

test('mDNS answers: GUID from the TXT record, IPv4 address, name', () => {
  const found = mdnsSpeakers([
    {
      name: 'Salon._bose-passport._tcp.local',
      addresses: ['fe80::1', '192.168.1.50'],
      port: 8280,
      txt: ['GUID=3C4FA1B2-5e6d-4f70-8a9b-0c1d2e3f4a5b', 'PRODUCT=Madrid'],
    },
    { name: 'no guid', addresses: ['192.168.1.9'], txt: [] },
    { name: 'no ipv4', addresses: ['fe80::2'], txt: ['GUID=abcd-1234'] },
  ]);
  assert.deepEqual(
    [...found.values()],
    [{ guid: SALON_GUID, host: '192.168.1.50', name: 'Salon' }],
  );
  assert.equal(normalizeGuid('bad guid!'), '');
  assert.deepEqual(parseHosts('192.168.1.50, 10.0.0.300 ;192.168.1.50 x'), ['192.168.1.50']);
});

test('parsers: the bodies of a speaker', () => {
  const salon = speaker({ battery: true });
  salon.network = { groupsOf: () => ({ activeGroups: [] }) };
  assert.equal(parsePower({ power: 'ON' }), true);
  assert.equal(parsePower({ power: 'NETWORK_STANDBY' }), false);
  assert.equal(parsePower({}), null);
  assert.deepEqual(parseVolume(salon.volumeBody()), { level: 30, muted: false });
  assert.deepEqual(parseVolume({ value: 140 }), { level: 100, muted: null });
  const playing = parseNowPlaying(salon.nowPlaying());
  assert.equal(playing.playing, true);
  assert.equal(playing.title, 'So What');
  assert.equal(playing.art, 'https://i.scdn.co/image/kind-of-blue');
  assert.deepEqual(parseNowPlaying(null).status, '');
  assert.deepEqual(selectableInputs(parseSources(salon.sources())), ['tv', 'optical']);
  const presets = parsePresets(salon.productSettings());
  assert.deepEqual(
    presets.map((preset) => [preset.id, preset.name, preset.content.source]),
    [
      ['1', 'FIP', 'TUNEIN'],
      ['2', 'Jazz', 'SPOTIFY'],
    ],
  );
  assert.deepEqual(parseAudioSetting(salon.audioBody('center')), {
    value: -20,
    min: -100,
    max: 100,
    step: 10,
  });
  assert.equal(parseAudioSetting({ value: true }), null);
  assert.deepEqual(parseAudioMode(salon.modeBody()), {
    value: 'NORMAL',
    options: ['NORMAL', 'DIALOG'],
  });
  assert.deepEqual(parseBattery(salon.battery), { percent: 64, charging: false });
  assert.equal(parseGroup({ activeGroups: [] }), null);
  assert.deepEqual(
    parseGroup({
      activeGroups: [
        {
          activeGroupId: 'g1',
          groupMasterId: 'a',
          products: [{ productId: 'a' }, { productId: 'b' }],
        },
      ],
    }),
    { id: 'g1', master: 'a', members: ['a', 'b'] },
  );
});
