// -----------------------------------------------------------------------------
// Finding the speakers on the local network.
//
// The Bose Music speakers announce the mDNS service `_bose-passport._tcp`,
// with their GUID in the TXT record. The integration container sits behind
// the Docker bridge, where multicast never reaches the LAN: the search goes
// through the mediated mDNS scan of Gladys (the core browses the service on
// the host network and relays the raw answers). The WebSocket of the
// speaker is then reached by unicast from the container (port 8082, which
// is not the port of the announcement: only the address is used).
//
// The addresses typed in the configuration are tried directly: speakers on
// another subnet, or a network that filters multicast.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';

export const MDNS_SERVICE = '_bose-passport._tcp';
export const SCAN_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export const isIpv4 = (value) =>
  IPV4.test(String(value)) &&
  String(value)
    .split('.')
    .every((octet) => Number(octet) <= 255);

/**
 * @description Normalize a speaker GUID into an external id part.
 * @param {string} value - GUID as the speaker gives it.
 * @returns {string} Lowercase letters, digits and dashes; '' when unusable.
 */
export function normalizeGuid(value) {
  const guid = String(value ?? '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9-]{3,63}$/.test(guid) ? guid : '';
}

/**
 * @description The speakers of an mDNS scan.
 * @param {Array} results - `scanNetwork('mdns')` results.
 * @returns {Map<string, { guid: string, host: string, name: string }>} GUID -> speaker.
 */
export function mdnsSpeakers(results) {
  const speakers = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const txt = parseMdnsTxt(Array.isArray(result?.txt) ? result.txt : []);
    const guid = normalizeGuid(txt.guid);
    const host = (Array.isArray(result?.addresses) ? result.addresses : []).find(isIpv4);
    if (!guid || !host) {
      continue;
    }
    // The instance name is the speaker name the user gave, before the service type.
    const name = String(result?.name ?? '')
      .replace(/\._bose-passport\._tcp(\.local)?\.?$/i, '')
      .trim();
    speakers.set(guid, { guid, host, name });
  }
  return speakers;
}

/**
 * @description Run the mediated mDNS scan.
 * @param {object} gladys - SDK client.
 * @param {object} [options] - `{ logger, timeoutSeconds }`.
 * @returns {Promise<{ speakers: Map, error: string|null }>} The speakers found and why
 * the scan failed, if it did.
 */
export async function mdnsScan(gladys, { logger, timeoutSeconds = SCAN_SECONDS } = {}) {
  try {
    const results = await gladys.scanNetwork('mdns', { timeoutSeconds });
    return { speakers: mdnsSpeakers(results), error: null };
  } catch (error) {
    if (error?.status === 403) {
      logger?.warn(
        'Bose: Gladys refused the network scan (reinstall the integration to accept its network discovery)',
      );
      return { speakers: new Map(), error: 'forbidden' };
    }
    if (error?.status === 429 || error?.status === 409) {
      return { speakers: new Map(), error: 'busy' };
    }
    logger?.warn(`Bose: network scan failed: ${error?.message ?? error}`);
    return { speakers: new Map(), error: 'failed' };
  }
}

/**
 * @description Parse the addresses typed in the configuration.
 * @param {string} value - `192.168.1.20, 192.168.1.21`.
 * @returns {string[]} The valid IPv4 addresses, deduplicated.
 */
export function parseHosts(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter(isIpv4),
    ),
  ];
}
