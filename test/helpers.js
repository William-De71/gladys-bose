// Test helpers: a clock, a silent logger, waiting, and a whole fake world —
// the fake Bose cloud (test/helpers/fake-bose-cloud.js) and fake speakers on
// real local WebSockets (test/helpers/fake-speaker.js) — that the
// integration reaches through its real code (src/bose/auth.js,
// src/bose/connection.js). Nothing leaves 127.0.0.1.

import { openConnection } from '../src/bose/connection.js';
import { FakeBoseCloud } from './helpers/fake-bose-cloud.js';
import { FakeBoseNetwork, FakeSpeaker } from './helpers/fake-speaker.js';

export { EMAIL, PASSWORD, jwt } from './helpers/fake-bose-cloud.js';
export { FakeBoseCloud, FakeBoseNetwork, FakeSpeaker };

/** A small valid PNG (1 × 1, transparent). */
export const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

export const SALON_GUID = '3c4fa1b2-5e6d-4f70-8a9b-0c1d2e3f4a5b';
export const KITCHEN_GUID = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

export function fakeClock(start = Date.parse('2026-10-20T18:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * @description The fake world: a Bose cloud, speakers on 127.0.0.1, and the
 * `connect` the integration uses to reach them by their LAN address.
 * @param {FakeSpeaker[]} speakers - Speakers.
 * @returns {Promise<object>} `{ cloud, network, connect, stop }`.
 */
export async function fakeWorld(speakers) {
  const cloud = new FakeBoseCloud();
  const network = await new FakeBoseNetwork(speakers).start();
  // Every token the account gets is the one its speakers accept.
  cloud.onAccessToken = (token) => speakers.forEach((speaker) => (speaker.token = token));
  const connect = (options) => {
    const port = network.portOf(options.host);
    if (!port) {
      return Promise.reject(
        Object.assign(new Error(`cannot connect to ${options.host}:8082: ECONNREFUSED`), {
          kind: 'connect',
        }),
      );
    }
    return openConnection({ ...options, host: '127.0.0.1', port, secure: false, timeoutMs: 1500 });
  };
  return { cloud, network, connect, stop: () => network.stop() };
}
