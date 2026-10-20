// -----------------------------------------------------------------------------
// One WebSocket connection to a Bose speaker, on the local network.
//
// The protocol, as documented by the pybose project (GPL-3.0, read as a
// description only — this is an independent implementation):
//
//   - `wss://<ip>:8082/?product=<client id>`, sub-protocol `eco2`, with a
//     self-signed certificate (the speaker has no name a CA could vouch for);
//   - every message is JSON `{ header, body }`. A request header carries
//     `device` (the GUID of the speaker), `method` (GET, PUT, POST, DELETE),
//     `msgtype: "REQUEST"`, `reqID` (a counter), `resource`, `status: 200`,
//     `token` (the Bose account token, see src/bose/auth.js) and `version`;
//   - the speaker answers with `msgtype: "RESPONSE"` and the same `reqID`;
//     `header.status` other than 200 is an error, described by a top-level
//     `error: { code, message }`;
//   - after `PUT /subscription` (version 2), it pushes `NOTIFY` messages
//     with the resource that changed and its new body: no polling needed;
//   - the GUID arrives in the `device` header of the first message the
//     speaker sends after the connection; requests wait for it;
//   - a speaker whose clock is a little late refuses a fresh token ("JWT not
//     before check failed"): the request is tried again a few seconds later;
//   - a speaker says nothing about a request it cannot answer: every
//     request has a timeout.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';

export const PORT = 8082;
export const SUBPROTOCOL = 'eco2';
// The client identifier the Bose app sends, also used by pybose and the Home
// Assistant integration: speakers accept it with any account token.
export const CLIENT_ID = 'Madrid-iOS:31019F02-F01F-4E73-B495-B96D33AD3664';

const OPEN_TIMEOUT_MS = 8000;
const GUID_WAIT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;
const NOT_BEFORE_RETRIES = 3;
const NOT_BEFORE_DELAY_MS = 2000;

/** An error of the speaker or of the connection, without any token in it. */
export class BoseError extends Error {
  /**
   * @param {string} message - Description.
   * @param {object} [details] - `{ status, code, resource, method, kind }`.
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'BoseError';
    Object.assign(this, details);
  }
}

/**
 * @description Open a connection.
 * @param {object} options - Options.
 * @param {string} options.host - IP address.
 * @param {string} [options.guid] - GUID when known (mDNS): no need to wait for it.
 * @param {Function} options.getToken - `async () => accessToken`.
 * @param {Function} [options.onNotify] - `(resource, body) => void`, pushed changes.
 * @param {Function} [options.onClose] - `(error) => void`, the connection is lost.
 * @param {number} [options.port] - Port (tests).
 * @param {boolean} [options.secure] - wss (default) or ws (tests).
 * @param {number} [options.timeoutMs] - Request timeout.
 * @param {Function} [options.sleep] - Pause (tests).
 * @param {Function} [options.WebSocketImpl] - WebSocket class (tests).
 * @returns {Promise<object>} `{ guid, request, close, isOpen }`.
 */
export async function openConnection({
  host,
  guid = '',
  getToken,
  onNotify = () => {},
  onClose = () => {},
  port = PORT,
  secure = true,
  timeoutMs = REQUEST_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  WebSocketImpl = WebSocket,
}) {
  const url = `${secure ? 'wss' : 'ws'}://${host}:${port}/?product=${CLIENT_ID}`;
  const socket = new WebSocketImpl(url, [SUBPROTOCOL], {
    // Self-signed certificate of the speaker, on the local network.
    rejectUnauthorized: false,
    handshakeTimeout: OPEN_TIMEOUT_MS,
  });
  let deviceId = guid;
  let nextId = 1;
  let open = false;
  let closedByUs = false;
  const pending = new Map(); // reqID -> { resolve, reject, timer }
  let guidWaiters = [];

  const failAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
    guidWaiters.forEach((waiter) => waiter.reject(error));
    guidWaiters = [];
  };

  const handleMessage = (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    const header = message?.header ?? {};
    if (typeof header.device === 'string' && header.device && !deviceId) {
      deviceId = header.device;
      guidWaiters.forEach((waiter) => waiter.resolve(deviceId));
      guidWaiters = [];
    }
    if (header.msgtype === 'RESPONSE' && pending.has(header.reqID)) {
      const waiter = pending.get(header.reqID);
      pending.delete(header.reqID);
      clearTimeout(waiter.timer);
      if (header.status === 200) {
        waiter.resolve(message.body ?? {});
      } else {
        const error = message.error ?? {};
        waiter.reject(
          new BoseError(String(error.message ?? `status ${header.status}`), {
            status: header.status,
            code: error.code,
            resource: header.resource,
            method: header.method,
            kind: 'speaker',
          }),
        );
      }
      return;
    }
    if (typeof header.resource === 'string' && header.msgtype !== 'RESPONSE') {
      onNotify(header.resource, message.body ?? {});
    }
  };

  // Listening before the opening: the speaker speaks first.
  socket.on('message', handleMessage);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate?.();
      reject(new BoseError(`no answer from ${host}:${port}`, { kind: 'connect' }));
    }, OPEN_TIMEOUT_MS + 1000);
    socket.once('open', () => {
      clearTimeout(timer);
      open = true;
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(
        new BoseError(`cannot connect to ${host}:${port}: ${error.message}`, { kind: 'connect' }),
      );
    });
  });

  socket.on('error', () => {
    // Followed by 'close', where the loss is reported.
  });
  socket.on('close', () => {
    const wasOpen = open;
    open = false;
    const error = new BoseError(`connection to ${host} closed`, { kind: 'closed' });
    failAll(error);
    if (wasOpen && !closedByUs) {
      onClose(error);
    }
  });

  const waitForGuid = () => {
    if (deviceId) {
      return Promise.resolve(deviceId);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      guidWaiters.push(waiter);
      setTimeout(() => {
        if (guidWaiters.includes(waiter)) {
          guidWaiters = guidWaiters.filter((item) => item !== waiter);
          reject(new BoseError(`${host} did not say who it is`, { kind: 'guid' }));
        }
      }, GUID_WAIT_MS).unref?.();
    });
  };

  const send = async (resource, method, body, version) => {
    const id = await waitForGuid();
    if (!open) {
      throw new BoseError(`connection to ${host} closed`, { kind: 'closed' });
    }
    const token = await getToken();
    const reqID = nextId++;
    const message = {
      header: {
        device: id,
        method,
        msgtype: 'REQUEST',
        reqID,
        resource,
        status: 200,
        token,
        version,
      },
      body,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqID);
        reject(
          new BoseError(`no answer to ${method} ${resource}`, {
            status: 408,
            resource,
            method,
            kind: 'timeout',
          }),
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(reqID, { resolve, reject, timer });
      socket.send(JSON.stringify(message), (error) => {
        if (error && pending.has(reqID)) {
          clearTimeout(timer);
          pending.delete(reqID);
          reject(new BoseError(`cannot send to ${host}: ${error.message}`, { kind: 'closed' }));
        }
      });
    });
  };

  return {
    get guid() {
      return deviceId;
    },

    isOpen: () => open,

    /** Wait for the GUID of the speaker (sent with its first message). */
    waitForGuid,

    /**
     * @description Send a request and wait for its answer.
     * @param {string} resource - `/audio/volume`…
     * @param {string} [method] - GET, PUT, POST or DELETE.
     * @param {object} [body] - Request body.
     * @param {object} [options] - `{ version }` (1 by default, 2 for /subscription).
     * @returns {Promise<object>} The response body.
     */
    async request(resource, method = 'GET', body = {}, { version = 1 } = {}) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await send(resource, method, body, version);
        } catch (error) {
          const notBefore =
            error.status === 401 &&
            /not before/i.test(error.message ?? '') &&
            attempt < NOT_BEFORE_RETRIES;
          if (!notBefore) {
            throw error;
          }
          await sleep(NOT_BEFORE_DELAY_MS);
        }
      }
    },

    close() {
      closedByUs = true;
      open = false;
      failAll(new BoseError(`connection to ${host} closed`, { kind: 'closed' }));
      try {
        socket.close();
      } catch {
        socket.terminate?.();
      }
    },
  };
}
