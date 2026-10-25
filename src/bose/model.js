// -----------------------------------------------------------------------------
// What a Bose speaker says, turned into plain values.
//
// The local API of the Bose Music speakers ("passport" products: Smart
// Soundbars, Home Speaker 500, Portable Smart Speaker, Music Amplifier…)
// answers JSON bodies per resource (`/audio/volume`, `/content/nowPlaying`…).
// The shapes come from the protocol notes of the pybose project (GPL-3.0,
// https://github.com/cavefire/pybose), read as documentation: this file is an
// independent JavaScript implementation, no code was copied.
//
// Every parser is defensive: a field a firmware does not send gives a
// neutral value, never an exception.
// -----------------------------------------------------------------------------

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value) => (isObject(value) ? value : {});
const string = (value) => (typeof value === 'string' ? value : '');
const integer = (value) => (Number.isInteger(value) ? value : null);
const seconds = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

/** The sound settings handled as features, with the resource of each. */
export const AUDIO_SETTINGS = {
  bass: '/audio/bass',
  midrange: '/audio/midrange',
  treble: '/audio/treble',
  center: '/audio/center',
  surround: '/audio/surround',
  height: '/audio/height',
  subwoofer: '/audio/subwooferGain',
};

/**
 * Inputs a soundbar can switch to with a playback request, by the value of
 * the Gladys source select (permanent: stored by Gladys).
 */
export const INPUTS = {
  tv: { source: 'PRODUCT', account: 'TV' },
  optical: { source: 'PRODUCT', account: 'AUX_DIGITAL' },
  analog: { source: 'PRODUCT', account: 'AUX_ANALOG' },
  aux: { source: 'AUX', account: 'AUX' },
};

/**
 * @description The endpoints a speaker declares in `/system/capabilities`.
 * @param {object} body - Response body.
 * @returns {Set<string>} The endpoints (`/audio/volume`…).
 */
export function parseCapabilities(body) {
  const endpoints = new Set();
  const groups = Array.isArray(object(body).group) ? body.group : [];
  for (const group of groups) {
    for (const endpoint of Array.isArray(group?.endpoints) ? group.endpoints : []) {
      if (typeof endpoint?.endpoint === 'string') {
        endpoints.add(endpoint.endpoint);
      }
    }
  }
  return endpoints;
}

/**
 * @description `/system/info`: name and model.
 * @param {object} body - Response body.
 * @returns {{ name: string, product: string, type: string, serial: string, firmware: string }} Info.
 */
export function parseSystemInfo(body) {
  const info = object(body);
  return {
    name: string(info.name) || string(info.defaultName),
    product: string(info.productName),
    type: string(info.productType),
    serial: string(info.serialNumber),
    firmware: string(info.softwareVersion),
  };
}

/**
 * @description `/system/power/control`: on or not (standby, network standby).
 * @param {object} body - Response body.
 * @returns {boolean|null} On, or null when the body says nothing.
 */
export function parsePower(body) {
  const power = string(object(body).power);
  return power ? power === 'ON' : null;
}

/**
 * @description `/audio/volume`.
 * @param {object} body - Response body.
 * @returns {{ level: number|null, muted: boolean|null }} Volume (0-100) and mute.
 */
export function parseVolume(body) {
  const volume = object(body);
  const level = integer(volume.value);
  return {
    level: level === null ? null : Math.min(100, Math.max(0, level)),
    muted: typeof volume.muted === 'boolean' ? volume.muted : null,
  };
}

/**
 * @description `/content/nowPlaying`.
 * @param {object} body - Response body.
 * @returns {object} `{ status, playing, sourceId, sourceName, contentSource,
 * contentAccount, location, title, artist, album, art, duration, position }`.
 */
export function parseNowPlaying(body) {
  const nowPlaying = object(body);
  const state = object(nowPlaying.state);
  const metadata = object(nowPlaying.metadata);
  const source = object(nowPlaying.source);
  const container = object(object(nowPlaying.container).contentItem);
  const track = object(object(nowPlaying.track).contentItem);
  const status = string(state.status);
  return {
    status,
    playing: status === 'PLAY' || status === 'BUFFERING',
    sourceId: string(source.sourceID),
    sourceName: string(source.sourceDisplayName),
    contentSource: string(container.source),
    contentAccount: string(container.sourceAccount),
    location: string(container.location),
    title: string(metadata.trackName),
    artist: string(metadata.artist),
    album: string(metadata.album),
    // Cover art: an https URL of the music service, when it gives one.
    art: string(track.containerArt) || string(container.containerArt),
    // Seconds, null when the speaker does not say (a live stream, an input).
    // `timeIntoTrack` is a sample: the position when the speaker wrote the body.
    duration: seconds(metadata.duration),
    position: seconds(state.timeIntoTrack),
  };
}

/**
 * @description `/system/sources`: the sources of the speaker.
 * @param {object} body - Response body.
 * @returns {Array<{ source: string, account: string, status: string, name: string }>} Sources.
 */
export function parseSources(body) {
  const list = Array.isArray(object(body).sources) ? body.sources : [];
  return list.filter(isObject).map((item) => ({
    source: string(item.sourceName),
    account: string(item.sourceAccountName),
    status: string(item.status),
    name: string(item.displayName),
  }));
}

/**
 * @description The inputs the Gladys select offers: the ones the speaker
 * lists as available or not configured (TV always when listed).
 * @param {Array} sources - parseSources().
 * @returns {string[]} Values of INPUTS, in a fixed order.
 */
export function selectableInputs(sources) {
  const usable = (sources ?? []).filter(
    (item) =>
      ['AVAILABLE', 'NOT_CONFIGURED'].includes(item.status) ||
      (item.source === 'PRODUCT' && item.account === 'TV'),
  );
  return Object.entries(INPUTS)
    .filter(([, input]) =>
      usable.some((item) => item.source === input.source && item.account === input.account),
    )
    .map(([value]) => value);
}

/**
 * @description `/system/productSettings`: the presets (1 to 6 on most
 * models), with what is needed to play them again.
 * @param {object} body - Response body.
 * @returns {Array<{ id: string, name: string, content: object }>} Presets, by number.
 */
export function parsePresets(body) {
  const presets = object(object(object(body).presets).presets);
  return Object.entries(presets)
    .filter(([id]) => /^\d{1,2}$/.test(id))
    .map(([id, preset]) => {
      const action = Array.isArray(preset?.actions) ? object(preset.actions[0]) : {};
      const content = object(object(action.payload).contentItem);
      return { id, name: string(content.name) || string(object(action.metadata).name), content };
    })
    .filter((preset) => preset.content.source)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * @description A numeric sound setting (`/audio/bass`…): value and range.
 * @param {object} body - Response body.
 * @returns {{ value: number, min: number, max: number, step: number }|null} The
 * setting, null when the body is not a numeric setting.
 */
export function parseAudioSetting(body) {
  const setting = object(body);
  // `true` is not a number here: some resources answer booleans.
  if (!Number.isInteger(setting.value)) {
    return null;
  }
  const properties = object(setting.properties);
  const min = integer(properties.min) ?? -100;
  const max = integer(properties.max) ?? 100;
  const step = integer(properties.step) > 0 ? properties.step : 10;
  if (min >= max) {
    return null;
  }
  return { value: Math.min(max, Math.max(min, setting.value)), min, max, step };
}

/**
 * @description `/audio/mode` (dialogue mode of the soundbars).
 * @param {object} body - Response body.
 * @returns {{ value: string, options: string[] }|null} Mode and the modes offered.
 */
export function parseAudioMode(body) {
  const mode = object(body);
  const options = Array.isArray(object(mode.properties).supportedValues)
    ? mode.properties.supportedValues.filter((value) => typeof value === 'string' && value)
    : [];
  const value = string(mode.value);
  if (!value && options.length === 0) {
    return null;
  }
  return { value, options: options.includes(value) || !value ? options : [...options, value] };
}

/**
 * @description `/system/battery` (portable speakers).
 * @param {object} body - Response body.
 * @returns {{ percent: number|null, charging: boolean }} Battery.
 */
export function parseBattery(body) {
  const battery = object(body);
  const percent = integer(battery.percent);
  return {
    percent: percent === null ? null : Math.min(100, Math.max(0, percent)),
    charging: string(battery.chargeStatus) === 'CHARGING',
  };
}

/**
 * @description `/grouping/activeGroups`: the group this speaker is in.
 * @param {object} body - Response body.
 * @returns {{ id: string, master: string, members: string[] }|null} The first
 * active group, null when the speaker plays alone.
 */
export function parseGroup(body) {
  const groups = Array.isArray(object(body).activeGroups) ? body.activeGroups : [];
  const group = object(groups[0]);
  const members = (Array.isArray(group.products) ? group.products : [])
    .map((product) => string(product?.productId))
    .filter(Boolean);
  if (!string(group.activeGroupId) || members.length < 2) {
    return null;
  }
  return { id: group.activeGroupId, master: string(group.groupMasterId), members };
}
