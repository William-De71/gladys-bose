// -----------------------------------------------------------------------------
// The Bose account: one valid token at hand, refreshed before it expires.
//
//   - the tokens live in /data/account.json (readable by the container user
//     only), tied to the e-mail they were obtained with: a restart reuses
//     them, a new e-mail drops them;
//   - every hour, a token with less than two hours left is refreshed (Azure
//     refresh token), and a full sign-in replaces a refused refresh;
//   - a refused e-mail or password is not tried again until the
//     configuration changes (an account locked by repeated attempts would be
//     worse); a Bose service that does not answer is tried again after two
//     minutes, then less and less often;
//   - nothing here logs a password or a token.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { AuthRejectedError } from './bose/auth.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const CHECK_EVERY_MS = HOUR;
const REFRESH_BEFORE_MS = 2 * HOUR;
const VALID_MARGIN_MS = 5 * MINUTE;
const UNKNOWN_EXPIRY_MS = HOUR;
const RETRY_MS = [2 * MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR];
const FILE = 'account.json';

export const ACCOUNT_STATUS = {
  MISSING: 'missing',
  OK: 'ok',
  REJECTED: 'rejected',
  UNAVAILABLE: 'unavailable',
};

const fingerprint = (email) =>
  createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 16);

/**
 * @description Create the account manager.
 * @param {object} deps - Dependencies.
 * @param {object} deps.auth - src/bose/auth.js client (tests: the fake cloud).
 * @param {object} deps.storage - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {Function} [deps.onChange] - `(status) => void`, the status changed.
 * @returns {object} The account.
 */
export function createAccount({ auth, storage, logger = sdkLogger, now = Date.now, onChange }) {
  let email = '';
  let password = '';
  let tokens = null;
  let status = ACCOUNT_STATUS.MISSING;
  let detail = '';
  let failures = 0;
  let retryAt = 0;
  let timer = null;
  let running = null;
  let loaded = false;

  const setStatus = (next, message = '') => {
    const changed = next !== status;
    status = next;
    detail = message;
    if (changed) {
      onChange?.(status);
    }
  };

  const save = () =>
    storage
      .write(
        FILE,
        tokens
          ? {
              account: fingerprint(email),
              accessToken: tokens.accessToken,
              personId: tokens.personId,
              expiresAt: tokens.expiresAt,
              azureRefreshToken: tokens.azureRefreshToken,
            }
          : null,
      )
      .catch((error) => logger.warn(`Bose: cannot save the account token: ${error.message}`));

  const accept = async (result) => {
    tokens = {
      accessToken: result.accessToken,
      personId: result.personId || tokens?.personId || '',
      expiresAt: result.expiresAt || now() + UNKNOWN_EXPIRY_MS,
      azureRefreshToken: result.azureRefreshToken || tokens?.azureRefreshToken || '',
    };
    failures = 0;
    retryAt = 0;
    await save();
    setStatus(ACCOUNT_STATUS.OK);
  };

  const fail = (error) => {
    if (error instanceof AuthRejectedError) {
      // Never retried on its own: the user has to fix the configuration.
      setStatus(ACCOUNT_STATUS.REJECTED, error.message);
      logger.warn(`Bose: the Bose account was refused (${error.message})`);
      return;
    }
    retryAt = now() + RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures += 1;
    if (!tokens || tokens.expiresAt <= now()) {
      setStatus(ACCOUNT_STATUS.UNAVAILABLE, error.message);
    }
    logger.warn(`Bose: Bose sign-in failed, trying again later (${error.message})`);
  };

  const load = async () => {
    if (loaded) {
      return;
    }
    loaded = true;
    const saved = await storage.read(FILE);
    if (
      saved &&
      saved.account === fingerprint(email) &&
      typeof saved.accessToken === 'string' &&
      saved.accessToken
    ) {
      tokens = {
        accessToken: saved.accessToken,
        personId: String(saved.personId ?? ''),
        expiresAt: Number(saved.expiresAt) || 0,
        azureRefreshToken: String(saved.azureRefreshToken ?? ''),
      };
    }
  };

  /** Refresh, or sign in again, when needed. */
  const renew = async ({ force = false } = {}) => {
    if (!email || !password) {
      tokens = null;
      setStatus(ACCOUNT_STATUS.MISSING);
      return;
    }
    await load();
    const left = tokens ? tokens.expiresAt - now() : -1;
    if (!force && tokens && left > REFRESH_BEFORE_MS) {
      setStatus(ACCOUNT_STATUS.OK);
      return;
    }
    if (status === ACCOUNT_STATUS.REJECTED) {
      return;
    }
    if (!force && retryAt > now()) {
      return;
    }
    if (tokens?.azureRefreshToken) {
      try {
        await accept(await auth.refresh(tokens.azureRefreshToken));
        logger.info('Bose: account token refreshed');
        return;
      } catch (error) {
        if (!(error instanceof AuthRejectedError)) {
          fail(error);
          return;
        }
        // A refused refresh token: a full sign-in below.
      }
    }
    try {
      await accept(await auth.login(email, password));
      logger.info('Bose: signed in to the Bose account');
    } catch (error) {
      fail(error);
    }
  };

  const renewOnce = (options) => {
    if (!running) {
      running = renew(options).finally(() => {
        running = null;
      });
    }
    return running;
  };

  return {
    /**
     * @description Set the credentials; a new e-mail or password signs in again.
     * @param {string} newEmail - E-mail of the Bose account.
     * @param {string} newPassword - Password.
     * @returns {boolean} The credentials changed.
     */
    configure(newEmail, newPassword) {
      const nextEmail = String(newEmail ?? '').trim();
      const nextPassword = String(newPassword ?? '');
      if (nextEmail === email && nextPassword === password) {
        return false;
      }
      if (fingerprint(nextEmail) !== fingerprint(email)) {
        tokens = null;
        loaded = false;
      }
      email = nextEmail;
      password = nextPassword;
      failures = 0;
      retryAt = 0;
      // A refused account gets a new chance with new credentials.
      if (status === ACCOUNT_STATUS.REJECTED) {
        setStatus(ACCOUNT_STATUS.MISSING);
      }
      return true;
    },

    /** Load the saved token, renew it if needed, then check every hour. */
    async start() {
      await renewOnce();
      clearInterval(timer);
      timer = setInterval(() => {
        renewOnce().catch(() => {});
      }, CHECK_EVERY_MS);
      timer.unref?.();
    },

    stop() {
      clearInterval(timer);
      timer = null;
    },

    /** Renew now, whatever the expiry (a speaker refused the token). */
    renew: (options = { force: true }) => renewOnce(options),

    /**
     * @description A token the speakers accept.
     * @returns {Promise<string>} The access token.
     */
    async token() {
      if (!tokens || tokens.expiresAt - now() < VALID_MARGIN_MS) {
        await renewOnce();
      }
      if (!tokens || tokens.expiresAt <= now()) {
        const error = new Error('no valid Bose account token');
        error.kind = 'token';
        throw error;
      }
      return tokens.accessToken;
    },

    /** The Bose person id (initiator of a preset playback). */
    personId: () => tokens?.personId ?? '',

    hasToken: () => Boolean(tokens && tokens.expiresAt > now()),

    status: () => status,

    detail: () => detail,
  };
}
