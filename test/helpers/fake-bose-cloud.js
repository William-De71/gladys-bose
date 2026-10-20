// A fake Bose cloud behind a fake `fetch`: the Azure AD B2C sign-in pages of
// myboseid.bose.com and the token exchange of id.api.bose.io, as the pybose
// project documents them. Every step checks what a real B2C tenant checks:
// cookies of the session, anti-forgery token in X-CSRF-TOKEN, transaction id,
// PKCE verifier against the challenge. A wrong e-mail or password is refused
// the B2C way: HTTP 200 with `{ "status": "400" }`.

import { createHash } from 'node:crypto';

export const EMAIL = 'jane@example.com';
export const PASSWORD = 'correct horse battery staple';
const B2C = 'https://myboseid.bose.com/boseprodb2c.onmicrosoft.com';
const BOSE_TOKEN = 'https://id.api.bose.io/id-jwt-core/idps/aad/B2C_1A_MBI_SUSI/token';

/**
 * @description A JWT the integration can read the expiry of (not signed).
 * @param {number} exp - Expiry in seconds since the epoch.
 * @param {string} [subject] - Subject, to tell tokens apart.
 * @returns {string} The token.
 */
export function jwt(exp, subject = 'person-1') {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ exp, sub: subject })}.c2lnbmF0dXJl`;
}

const page = (csrf, tx) =>
  `<!DOCTYPE html><html><head><script>var SETTINGS = {"remoteResource":"https://myboseid.bose.com/static","csrf":"${csrf}","transId":"${tx}","api":"CombinedSigninAndSignup","pageViewId":"x"};</script></head><body><form id="localAccountForm"></form></body></html>`;

export class FakeBoseCloud {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.email = EMAIL;
    this.password = PASSWORD;
    this.lifetimeSeconds = 24 * 3600;
    this.calls = [];
    this.logins = 0;
    this.refreshes = 0;
    this.down = false;
    this.flow = null;
    this.refreshTokens = new Set();
    this.counter = 0;
    this.fetch = this.fetch.bind(this);
  }

  /** The access token speakers accept (FakeSpeaker.token), given at every exchange. */
  get accessToken() {
    return this.lastAccessToken;
  }

  cookie(headers, name) {
    const cookies = String(headers.Cookie ?? headers.cookie ?? '');
    return cookies
      .split(/;\s*/)
      .find((pair) => pair.startsWith(`${name}=`))
      ?.split('=')[1];
  }

  async fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const body = init.body ? String(init.body) : '';
    this.calls.push({ method, url: url.toString(), headers, body });
    if (this.down) {
      throw new TypeError('fetch failed');
    }
    const form = new URLSearchParams(body);
    const flow = this.flow;
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const path = `${url.origin}${url.pathname}`;

    if (method === 'GET' && path === `${B2C}/oauth2/v2.0/authorize`) {
      if (url.searchParams.get('code_challenge_method') !== 'S256') {
        return new Response('bad request', { status: 400 });
      }
      this.flow = {
        challenge: url.searchParams.get('code_challenge'),
        csrf: `csrf-${++this.counter}`,
        tx: `StateProperties=eyJUSUQiOiIke${this.counter}`,
        email: null,
        passed: false,
        code: null,
      };
      // B2C sends the browser to the policy URL first.
      return new Response(null, {
        status: 302,
        headers: new Headers([
          ['location', `/boseprodb2c.onmicrosoft.com/B2C_1A_MBI_SUSI/oauth2/v2.0/authorize?step=2`],
          ['set-cookie', 'x-ms-cpim-sso=sso; path=/; secure'],
        ]),
      });
    }
    if (method === 'GET' && path === `${B2C}/B2C_1A_MBI_SUSI/oauth2/v2.0/authorize`) {
      if (!flow || this.cookie(headers, 'x-ms-cpim-sso') !== 'sso') {
        return new Response('no session', { status: 400 });
      }
      return new Response(page(flow.csrf, flow.tx), {
        status: 200,
        headers: new Headers([
          ['content-type', 'text/html'],
          ['set-cookie', `x-ms-cpim-csrf=${flow.csrf}; path=/; secure`],
          ['set-cookie', `x-ms-cpim-trans=trans${this.counter}; path=/; secure`],
        ]),
      });
    }
    const checked = () =>
      flow &&
      headers['X-CSRF-TOKEN'] === flow.csrf &&
      url.searchParams.get('tx') === flow.tx &&
      this.cookie(headers, 'x-ms-cpim-trans') === `trans${this.counter}`;
    if (method === 'POST' && path === `${B2C}/B2C_1A_MBI_SUSI/SelfAsserted`) {
      if (!checked()) {
        return json({ status: '403', message: 'forbidden' }, 403);
      }
      if (form.has('email')) {
        if (form.get('email') !== this.email) {
          return json({ status: '400', message: 'We can’t seem to find your account.' });
        }
        flow.email = form.get('email');
        return json({ status: '200' });
      }
      if (form.get('readonlyEmail') !== flow.email || form.get('password') !== this.password) {
        return json({ status: '400', message: 'Your password is incorrect.' });
      }
      flow.passed = true;
      return json({ status: '200' });
    }
    if (
      method === 'GET' &&
      path === `${B2C}/B2C_1A_MBI_SUSI/api/CombinedSigninAndSignup/confirmed`
    ) {
      if (!flow?.email || url.searchParams.get('csrf_token') !== flow.csrf) {
        return new Response('error', { status: 400 });
      }
      // The password page comes with a new anti-forgery token.
      flow.csrf = `csrf-${this.counter}-b`;
      return new Response(page(flow.csrf, flow.tx), { status: 200 });
    }
    if (method === 'GET' && path === `${B2C}/B2C_1A_MBI_SUSI/api/SelfAsserted/confirmed`) {
      if (!flow?.passed || url.searchParams.get('csrf_token') !== flow.csrf) {
        // B2C shows the form again.
        return new Response(page(flow?.csrf ?? '', flow?.tx ?? ''), { status: 200 });
      }
      flow.code = `code-${this.counter}`;
      return new Response(null, {
        status: 302,
        headers: { location: `bosemusic://auth/callback?code=${flow.code}` },
      });
    }
    if (method === 'POST' && path === `${B2C}/oauth2/v2.0/token`) {
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!flow?.code || form.get('code') !== flow.code || challenge !== flow.challenge) {
        return json({ error: 'invalid_grant' }, 400);
      }
      this.flow = null;
      this.logins += 1;
      return json(this.azureTokens());
    }
    if (method === 'POST' && path === `${B2C}/B2C_1A_MBI_SUSI/oauth2/v2.0/token`) {
      const token = form.get('refresh_token');
      if (form.get('grant_type') !== 'refresh_token' || !this.refreshTokens.has(token)) {
        return json({ error: 'invalid_grant' }, 400);
      }
      this.refreshTokens.delete(token);
      this.refreshes += 1;
      return json(this.azureTokens());
    }
    if (method === 'POST' && path === BOSE_TOKEN) {
      const request = JSON.parse(body || '{}');
      if (headers['X-ApiKey'] !== '67616C617061676F732D70726F642D6D61647269642D696F73') {
        return json({ message: 'bad api key' }, 403);
      }
      if (request.grant_type !== 'id_token' || !String(request.id_token).startsWith('id-')) {
        return json({ message: 'bad id token' }, 401);
      }
      const exp = Math.floor(this.now() / 1000) + this.lifetimeSeconds;
      this.lastAccessToken = jwt(exp, `person-1-${this.counter}`);
      this.onAccessToken?.(this.lastAccessToken);
      return json({
        access_token: this.lastAccessToken,
        bosePersonID: 'person-1',
        expires_in: this.lifetimeSeconds,
        refresh_token: 'bose-refresh',
        scope: 'openid',
        token_type: 'Bearer',
      });
    }
    return new Response('not found', { status: 404 });
  }

  azureTokens() {
    const refresh = `azure-refresh-${++this.counter}`;
    this.refreshTokens.add(refresh);
    return {
      access_token: 'azure-access',
      id_token: `id-${this.counter}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      scope: 'openid',
    };
  }
}
