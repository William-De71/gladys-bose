// -----------------------------------------------------------------------------
// The Bose account token.
//
// A Bose speaker is controlled locally, but only with a token of the Bose
// account it belongs to: Bose made it so. That token is obtained like the
// Bose app does, from the Bose cloud, once, then refreshed before it expires.
// No command and no state goes through the cloud.
//
// The sign-in flow, as documented by the pybose project (GPL-3.0, read as a
// description only — this is an independent implementation):
//
//   1. the Bose account is an Azure AD B2C tenant (myboseid.bose.com,
//      policy B2C_1A_MBI_SUSI, public client id of the Bose app). The
//      sign-in pages are driven like a browser: authorize (PKCE S256), post
//      the e-mail, confirm, post the password, confirm, and the last page
//      redirects to `bosemusic://auth/callback?code=…`;
//   2. the code is exchanged for Azure tokens (id_token, refresh_token);
//   3. the id_token is exchanged at id.api.bose.io for the Bose tokens: the
//      `access_token` (a JWT) the speakers accept, and the `bosePersonID`
//      the presets need;
//   4. refreshing: the Azure refresh_token gives a new id_token, exchanged
//      again as in 3.
//
// Everything goes through an injected `fetch`, so the tests replace the
// Bose cloud by a fake one (test/fake-bose-cloud.js). Nothing here ever
// logs a password or a token.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';

const B2C_BASE = 'https://myboseid.bose.com';
const TENANT = 'boseprodb2c.onmicrosoft.com';
const POLICY = 'B2C_1A_MBI_SUSI';
// Public identifiers of the Bose app, the same for every user.
const CLIENT_ID = 'e284648d-3009-47eb-8e74-670c5330ae54';
const REDIRECT_URI = 'bosemusic://auth/callback';
const SCOPE = `openid email profile offline_access ${CLIENT_ID}`;
const BOSE_TOKEN_URL = `https://id.api.bose.io/id-jwt-core/idps/aad/${POLICY}/token`;
// "galapagos-prod-madrid-ios" in hex: the public API key of the Bose app.
const BOSE_API_KEY = '67616C617061676F732D70726F642D6D61647269642D696F73';
const USER_AGENT = 'Mozilla/5.0 (compatible; gladys-bose)';
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 10;

/** The account was refused (wrong e-mail or password, revoked refresh token). */
export class AuthRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRejectedError';
  }
}

/** The Bose sign-in service did not answer as expected: try again later. */
export class AuthUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthUnavailableError';
  }
}

const errorFor = (status, what) =>
  [400, 401, 403].includes(status)
    ? new AuthRejectedError(`${what}: refused (HTTP ${status})`)
    : new AuthUnavailableError(`${what}: HTTP ${status}`);

const base64url = (buffer) => buffer.toString('base64url');

/**
 * @description A PKCE pair (RFC 7636, S256).
 * @returns {{ verifier: string, challenge: string }} The pair.
 */
export function pkcePair() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * @description The expiry date of a JWT (its `exp` claim), without checking
 * the signature: only the speaker checks it.
 * @param {string} token - JWT.
 * @returns {number} Expiry in ms since the epoch, 0 when unreadable.
 */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * @description The anti-forgery token of a B2C page: in its settings
 * script, else in the `x-ms-cpim-csrf` cookie.
 * @param {string} html - Page.
 * @param {Map<string, string>} cookies - Cookie jar.
 * @returns {string} The token, '' when absent.
 */
export function findCsrf(html, cookies = new Map()) {
  const patterns = [/"csrf"\s*:\s*"([^"]+)"/, /x-ms-cpim-csrf["'\s]*[:=]\s*["']?([^"'\s;,]+)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      return match[1];
    }
  }
  for (const [name, value] of cookies) {
    if (name.toLowerCase().includes('csrf')) {
      return value;
    }
  }
  return '';
}

/**
 * @description The transaction id of a B2C flow (`tx`), in a page or a URL.
 * @param {string} text - Page or URL.
 * @returns {string} `StateProperties=…`, '' when absent.
 */
export function findTransaction(text) {
  const inUrl = /[?&]tx=([^&"'\s\\]+)/.exec(text);
  if (inUrl) {
    return decodeURIComponent(inUrl[1]);
  }
  const inSettings = /"transId"\s*:\s*"([^"]+)"/.exec(text);
  if (inSettings) {
    return inSettings[1];
  }
  const bare = /StateProperties=([^&"'\s\\]+)/.exec(text);
  return bare ? `StateProperties=${bare[1]}` : '';
}

/**
 * @description Create the Bose account client.
 * @param {object} [deps] - Dependencies.
 * @param {Function} [deps.fetch] - fetch (tests: the fake Bose cloud).
 * @returns {{ login: Function, refresh: Function }} The client.
 */
export function createBoseAuth({ fetch = globalThis.fetch } = {}) {
  /** A browser-like session: cookies kept, redirects followed by hand. */
  const session = () => {
    const cookies = new Map();
    const remember = (response) => {
      const lines = response.headers.getSetCookie?.() ?? [];
      for (const line of lines) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
          cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
      }
    };
    const call = async (url, { method = 'GET', headers = {}, body, follow = true } = {}) => {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        let response;
        try {
          response = await fetch(current, {
            method,
            headers: {
              'User-Agent': USER_AGENT,
              ...(cookies.size > 0
                ? {
                    Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
                  }
                : {}),
              ...headers,
            },
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch (error) {
          throw new AuthUnavailableError(`Bose sign-in unreachable: ${error.message}`);
        }
        remember(response);
        const location = response.headers.get('location');
        const isRedirect = response.status >= 300 && response.status < 400 && location;
        if (!follow || !isRedirect || location.startsWith('bosemusic:')) {
          return { response, url: current };
        }
        current = new URL(location, current).toString();
        method = 'GET';
        body = undefined;
      }
      throw new AuthUnavailableError('Bose sign-in: too many redirects');
    };
    return { cookies, call };
  };

  const form = (fields) => new URLSearchParams(fields).toString();

  /** POST a SelfAsserted step; B2C answers 200 with `{ status: "400" }` on a refusal. */
  const selfAsserted = async (web, { csrf, tx, referer }, fields, what) => {
    const url = `${B2C_BASE}/${TENANT}/${POLICY}/SelfAsserted?${form({ tx, p: POLICY })}`;
    const { response } = await web.call(url, {
      method: 'POST',
      headers: {
        'X-CSRF-TOKEN': csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: B2C_BASE,
        Referer: referer,
      },
      body: form({ request_type: 'RESPONSE', ...fields }),
    });
    if (response.status !== 200) {
      throw errorFor(response.status, what);
    }
    const text = await response.text();
    let answer = null;
    try {
      answer = JSON.parse(text);
    } catch {
      // Not JSON: accepted, the next step tells.
    }
    if (answer && answer.status !== undefined && String(answer.status) !== '200') {
      throw new AuthRejectedError(`${what}: refused by Bose`);
    }
  };

  /** Exchange an Azure id_token for the Bose tokens. */
  const boseTokens = async (idToken) => {
    let response;
    try {
      response = await fetch(BOSE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ApiKey': BOSE_API_KEY,
          'X-Api-Version': '1',
          'X-Software-Version': '1',
          'X-Library-Version': '1',
          'User-Agent': USER_AGENT,
          Accept: '*/*',
        },
        body: JSON.stringify({
          grant_type: 'id_token',
          id_token: idToken,
          client_id: CLIENT_ID,
          scope: SCOPE,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new AuthUnavailableError(`Bose token service unreachable: ${error.message}`);
    }
    if (![200, 201].includes(response.status)) {
      throw errorFor(response.status, 'Bose token exchange');
    }
    const tokens = await response.json().catch(() => ({}));
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
      throw new AuthUnavailableError('Bose token exchange: no access token in the answer');
    }
    return {
      accessToken: tokens.access_token,
      personId: String(tokens.bosePersonID ?? ''),
      expiresAt: tokenExpiry(tokens.access_token),
    };
  };

  const azureTokens = async (response, what) => {
    if (response.status !== 200) {
      throw errorFor(response.status, what);
    }
    const tokens = await response.json().catch(() => ({}));
    if (typeof tokens.id_token !== 'string' || !tokens.id_token) {
      throw new AuthUnavailableError(`${what}: no id_token in the answer`);
    }
    return tokens;
  };

  return {
    /**
     * @description Sign in with the e-mail and password of the Bose account.
     * @param {string} email - E-mail.
     * @param {string} password - Password.
     * @returns {Promise<object>} `{ accessToken, personId, expiresAt, azureRefreshToken }`.
     */
    async login(email, password) {
      const web = session();
      const { verifier, challenge } = pkcePair();
      const authorize = `${B2C_BASE}/${TENANT}/oauth2/v2.0/authorize?${form({
        p: POLICY,
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: SCOPE,
        code_challenge_method: 'S256',
        code_challenge: challenge,
        redirect_uri: REDIRECT_URI,
        ui_locales: 'en-us',
      })}`;
      const first = await web.call(authorize);
      if (first.response.status !== 200) {
        throw new AuthUnavailableError(`Bose sign-in page: HTTP ${first.response.status}`);
      }
      const page = await first.response.text();
      let csrf = findCsrf(page, web.cookies);
      let tx = findTransaction(page) || findTransaction(first.url);
      if (!csrf || !tx) {
        throw new AuthUnavailableError('Bose sign-in page: unexpected content (changed by Bose?)');
      }

      await selfAsserted(web, { csrf, tx, referer: first.url }, { email }, 'Bose e-mail step');

      const diags = (pageId, pageViewId) => JSON.stringify({ pageViewId, pageId, trace: [] });
      const confirmUrl = `${B2C_BASE}/${TENANT}/${POLICY}/api/CombinedSigninAndSignup/confirmed?${form(
        {
          rememberMe: 'false',
          csrf_token: csrf,
          tx,
          p: POLICY,
          diags: diags('CombinedSigninAndSignup', 'gladys-1'),
        },
      )}`;
      const confirmed = await web.call(confirmUrl);
      if (confirmed.response.status !== 200) {
        throw errorFor(confirmed.response.status, 'Bose e-mail confirmation');
      }
      const passwordPage = await confirmed.response.text();
      csrf = findCsrf(passwordPage, web.cookies) || csrf;
      tx = findTransaction(passwordPage) || tx;

      await selfAsserted(
        web,
        { csrf, tx, referer: confirmed.url },
        { readonlyEmail: email, password },
        'Bose password step',
      );

      const finalUrl = `${B2C_BASE}/${TENANT}/${POLICY}/api/SelfAsserted/confirmed?${form({
        csrf_token: csrf,
        tx,
        p: POLICY,
        diags: diags('SelfAsserted', 'gladys-2'),
      })}`;
      const last = await web.call(finalUrl, { follow: false });
      const location = last.response.headers.get('location') ?? '';
      let code;
      try {
        code = new URL(location).searchParams.get('code') ?? '';
      } catch {
        code = '';
      }
      if (!code) {
        // B2C shows the form again instead of redirecting when it refuses.
        throw last.response.status === 200
          ? new AuthRejectedError('Bose sign-in refused the e-mail or the password')
          : new AuthUnavailableError(`Bose sign-in: no code (HTTP ${last.response.status})`);
      }

      const exchanged = await web.call(
        `${B2C_BASE}/${TENANT}/oauth2/v2.0/token?${form({ p: POLICY })}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({
            client_id: CLIENT_ID,
            code_verifier: verifier,
            grant_type: 'authorization_code',
            scope: SCOPE,
            redirect_uri: REDIRECT_URI,
            code,
          }),
          follow: false,
        },
      );
      const azure = await azureTokens(exchanged.response, 'Bose code exchange');
      return {
        ...(await boseTokens(azure.id_token)),
        azureRefreshToken: azure.refresh_token ?? '',
      };
    },

    /**
     * @description Get new tokens with the Azure refresh token.
     * @param {string} azureRefreshToken - From the last login or refresh.
     * @returns {Promise<object>} `{ accessToken, personId, expiresAt, azureRefreshToken }`.
     */
    async refresh(azureRefreshToken) {
      if (!azureRefreshToken) {
        throw new AuthRejectedError('no refresh token: sign in again');
      }
      let response;
      try {
        response = await fetch(`${B2C_BASE}/${TENANT}/${POLICY}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': USER_AGENT,
            Accept: '*/*',
          },
          body: form({
            refresh_token: azureRefreshToken,
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new AuthUnavailableError(`Bose sign-in unreachable: ${error.message}`);
      }
      const azure = await azureTokens(response, 'Bose token refresh');
      return {
        ...(await boseTokens(azure.id_token)),
        azureRefreshToken: azure.refresh_token || azureRefreshToken,
      };
    },
  };
}
