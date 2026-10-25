// -----------------------------------------------------------------------------
// From a Bose speaker to a Gladys device, and back.
//
// One device per speaker, a music player in the Gladys sense: the `music/*`
// features drive the Music box of the dashboard (play, pause, previous,
// next, volume, playback state, and since Gladys 5.3 title, artist, album,
// cover, duration, position and mute); power, mute, source, what is
// playing, the sound settings and the battery show in the device box.
//
// The `text` features `title` and `artist` of 0.1 stay (scenes and boxes use
// them); the `music` ones live under their own keys (`music-title`…).
//
// The features depend on what the speaker has: a centre channel, a height
// channel, a dialogue mode on the soundbars; a battery on the portable
// ones. Feature keys are part of the external ids: permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  MUSIC_MEDIA_TYPES,
  MUSIC_PLAYBACK_STATE,
} from '@gladysassistant/integration-sdk';
import { AUDIO_SETTINGS, INPUTS, selectableInputs } from './bose/model.js';
import { text } from './i18n.js';

export const DEVICE_TYPE = 'speaker';

export const FEATURE_KEYS = {
  POWER: 'power',
  VOLUME: 'volume',
  MUTE: 'mute',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  PLAYBACK: 'playback-state',
  SOURCE: 'source',
  TITLE: 'title',
  ARTIST: 'artist',
  // Music player (Gladys 5.3): published with publishNowPlaying.
  MUSIC_TITLE: 'music-title',
  MUSIC_ARTIST: 'music-artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  MUSIC_MUTE: 'music-mute',
  AUDIO_MODE: 'audio-mode',
  BATTERY: 'battery',
  CHARGING: 'charging',
};

// Values of the source select. `other` is whatever Gladys cannot select
// itself (Spotify, AirPlay, a Bluetooth phone…): picking it does nothing.
// A preset is `preset-<n>`. Stored by Gladys: permanent.
export const SOURCE_OTHER = 'other';
export const presetValue = (id) => `preset-${id}`;

// Shown when there is nothing to say: Gladys ignores an empty text state.
export const NOTHING = '—';

const MAX_SETTING_OPTIONS = 41;
const MAX_TEXT = 200;
// Bound of `duration` and `position` (seconds): part of the compared fields,
// so generous once and for all.
const MAX_SECONDS = 24 * 60 * 60;
// Services whose presets are stations rather than playlists.
const RADIO_SOURCES = new Set(['TUNEIN', 'IHEART', 'SIRIUSXM', 'RADIOPLAYER', 'RADIO_COM']);

/**
 * @description The id of a speaker in the external ids: its GUID.
 * @param {object} entry - Speaker entry.
 * @returns {string} The GUID.
 */
export const platformId = (entry) => entry.guid;

/**
 * @description Name of the device: the name given in the Bose app.
 * @param {object} entry - Speaker entry.
 * @returns {string} The name.
 */
export function deviceName(entry) {
  const name = entry.info?.name || entry.mdnsName;
  if (name) {
    return name;
  }
  const model = entry.info?.product || 'Bose';
  return `${model} ${entry.guid
    .replace(/[^a-z0-9]/gi, '')
    .slice(-4)
    .toUpperCase()}`;
}

const feature = (key, language, spec) => ({
  key,
  name: text(`feature_${key}`, language),
  keep_history: false,
  ...spec,
});

/** A command button of the Music box: Gladys sends 1, nothing to read back. */
const button = (key, language, type) =>
  feature(key, language, {
    category: CATEGORIES.MUSIC,
    type,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
  });

const textFeature = (key, language) =>
  feature(key, language, {
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.TEXT,
    // NOT NULL in the core, even for a text (422 on "Add" otherwise).
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
  });

/** A `music` string state (title, artist, album, cover key). */
const musicText = (key, language, type) =>
  feature(key, language, {
    category: CATEGORIES.MUSIC,
    type,
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
  });

const select = (key, language, options) => ({
  ...feature(key, language, {
    category: CATEGORIES.TEXT,
    type: TYPES.TEXT.SELECT,
    min: 0,
    max: 0,
    read_only: false,
    has_feedback: true,
  }),
  supported_options: options.map((option, index) => ({ ...option, sort_order: index })),
});

/**
 * @description Label of a preset: "Preset 2 · FIP".
 * @param {object} preset - `{ id, name }`.
 * @param {string} language - Language.
 * @returns {string} The label.
 */
export function presetLabel(preset, language) {
  const prefix = `${text('preset', language)} ${preset.id}`;
  return preset.name ? `${prefix} · ${preset.name}` : prefix;
}

/**
 * @description Options of the source select, in display order.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language.
 * @returns {Array<{ value: string, label: string }>} Options.
 */
export function sourceOptions(entry, language) {
  const options = [{ value: SOURCE_OTHER, label: text('source_other', language) }];
  for (const input of selectableInputs(entry.sources)) {
    options.push({ value: input, label: text(`source_${input}`, language) });
  }
  for (const preset of entry.presets ?? []) {
    options.push({ value: presetValue(preset.id), label: presetLabel(preset, language) });
  }
  return options;
}

/**
 * @description Options of a sound setting: every step of its range, the
 * raw value of the speaker as value and label ("+20", "0", "-10").
 * @param {{ min: number, max: number, step: number }} setting - Range.
 * @returns {Array<{ value: string, label: string }>|null} Options, null when
 * the range has too many steps for a select.
 */
export function settingOptions({ min, max, step }) {
  const count = Math.floor((max - min) / step) + 1;
  if (count < 2 || count > MAX_SETTING_OPTIONS) {
    return null;
  }
  return Array.from({ length: count }, (_, index) => {
    const value = min + index * step;
    return { value: String(value), label: value > 0 ? `+${value}` : String(value) };
  });
}

/** The value of a sound setting, snapped on its options. */
const settingValue = (setting) => {
  const steps = Math.round((setting.value - setting.min) / setting.step);
  return String(Math.min(setting.max, setting.min + steps * setting.step));
};

/**
 * @description Feature specs of a speaker: what the Gladys device declares.
 * @param {object} entry - Speaker entry (read once connected).
 * @param {string} language - Language of the names.
 * @returns {object[]} Feature specs with their `key`.
 */
export function speakerSpecs(entry, language) {
  const specs = [
    feature(FEATURE_KEYS.POWER, language, {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    }),
    feature(FEATURE_KEYS.VOLUME, language, {
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.VOLUME,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
    }),
    feature(FEATURE_KEYS.MUTE, language, {
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
    }),
    button(FEATURE_KEYS.PLAY, language, TYPES.MUSIC.PLAY),
    button(FEATURE_KEYS.PAUSE, language, TYPES.MUSIC.PAUSE),
    button(FEATURE_KEYS.PREVIOUS, language, TYPES.MUSIC.PREVIOUS),
    button(FEATURE_KEYS.NEXT, language, TYPES.MUSIC.NEXT),
    {
      // Writable since Gladys 5.3: 1 plays, 0 pauses. The speakers have no
      // stop of their own: the subset is declared (and `max` stays 1).
      ...feature(FEATURE_KEYS.PLAYBACK, language, {
        category: CATEGORIES.MUSIC,
        type: TYPES.MUSIC.PLAYBACK_STATE,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
      supported_options: [
        {
          value: MUSIC_PLAYBACK_STATE.PAUSED,
          label: text('playback_paused', language),
          sort_order: 0,
        },
        {
          value: MUSIC_PLAYBACK_STATE.PLAYING,
          label: text('playback_playing', language),
          sort_order: 1,
        },
      ],
    },
    select(FEATURE_KEYS.SOURCE, language, sourceOptions(entry, language)),
    textFeature(FEATURE_KEYS.TITLE, language),
    textFeature(FEATURE_KEYS.ARTIST, language),
    musicText(FEATURE_KEYS.MUSIC_TITLE, language, TYPES.MUSIC.TITLE),
    musicText(FEATURE_KEYS.MUSIC_ARTIST, language, TYPES.MUSIC.ARTIST),
    musicText(FEATURE_KEYS.ALBUM, language, TYPES.MUSIC.ALBUM),
    musicText(FEATURE_KEYS.ARTWORK, language, TYPES.MUSIC.ARTWORK),
    feature(FEATURE_KEYS.DURATION, language, {
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.DURATION,
      unit: UNITS.SECONDS,
      min: 0,
      max: MAX_SECONDS,
      read_only: true,
      has_feedback: false,
    }),
    feature(FEATURE_KEYS.POSITION, language, {
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.POSITION,
      unit: UNITS.SECONDS,
      min: 0,
      max: MAX_SECONDS,
      read_only: false,
      has_feedback: true,
    }),
    feature(FEATURE_KEYS.MUSIC_MUTE, language, {
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.MUTE,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
    }),
  ];
  for (const key of Object.keys(AUDIO_SETTINGS)) {
    const setting = entry.audio?.[key];
    const options = setting ? settingOptions(setting) : null;
    if (options) {
      specs.push(select(key, language, options));
    }
  }
  if (entry.mode?.options?.length > 1) {
    specs.push(
      select(
        FEATURE_KEYS.AUDIO_MODE,
        language,
        entry.mode.options.map((value) => ({ value, label: modeLabel(value, language) })),
      ),
    );
  }
  if (entry.caps?.has('/system/battery') || entry.battery) {
    specs.push(
      feature(FEATURE_KEYS.BATTERY, language, {
        category: CATEGORIES.BATTERY,
        type: TYPES.BATTERY.INTEGER,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      }),
      feature(FEATURE_KEYS.CHARGING, language, {
        category: CATEGORIES.BATTERY,
        type: TYPES.BATTERY.CHARGING,
        min: 0,
        max: 1,
        read_only: true,
        has_feedback: false,
      }),
    );
  }
  return specs;
}

/**
 * @description Name of a dialogue mode (`NORMAL`, `DIALOG`…).
 * @param {string} value - Mode of the speaker.
 * @param {string} language - Language.
 * @returns {string} The label.
 */
export function modeLabel(value, language) {
  const known = { NORMAL: 'mode_normal', DIALOG: 'mode_dialog', DYNAMIC_DIALOG: 'mode_dynamic' };
  if (known[value]) {
    return text(known[value], language);
  }
  return value
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * @description The Gladys discovery payload of a speaker.
 * @param {object} gladys - SDK client.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language.
 * @returns {object} The device.
 */
export function buildDevice(gladys, entry, language) {
  const ids = gladys.externalIds(DEVICE_TYPE, platformId(entry));
  const params = [{ name: 'BOSE_HOST', value: entry.host }];
  if (entry.info?.product) {
    params.push({ name: 'BOSE_MODEL', value: entry.info.product });
  }
  if (entry.info?.firmware) {
    params.push({ name: 'BOSE_FIRMWARE', value: entry.info.firmware });
  }
  return {
    name: deviceName(entry),
    external_id: ids.device,
    model: entry.info?.product || 'Bose',
    // Pushed over the WebSocket and watched by the integration itself: the
    // Gladys scheduler never polls these devices (see src/hub.js).
    should_poll: false,
    params,
    features: speakerSpecs(entry, language).map(({ key, ...spec }) => ({
      ...spec,
      external_id: ids.feature(key),
    })),
  };
}

/**
 * @description The source the speaker plays, as a value of the select.
 * @param {object} entry - Speaker entry.
 * @returns {string} Value of the select.
 */
export function sourceValue(entry) {
  const playing = entry.nowPlaying;
  if (!playing || entry.on === false) {
    return SOURCE_OTHER;
  }
  for (const [value, input] of Object.entries(INPUTS)) {
    if (playing.contentSource === input.source && playing.contentAccount === input.account) {
      return value;
    }
  }
  const preset = (entry.presets ?? []).find(
    (candidate) =>
      candidate.content.location &&
      candidate.content.location === playing.location &&
      candidate.content.source === playing.contentSource,
  );
  return preset ? presetValue(preset.id) : SOURCE_OTHER;
}

/**
 * @description Human name of what the speaker plays: "TV", "Spotify"…
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language.
 * @returns {string} The name, '' when nothing plays.
 */
export function sourceLabel(entry, language) {
  if (entry.on === false) {
    return text('standby', language);
  }
  const playing = entry.nowPlaying;
  if (!playing) {
    return '';
  }
  const value = sourceValue(entry);
  if (value !== SOURCE_OTHER && !value.startsWith('preset-')) {
    return text(`source_${value}`, language);
  }
  if (playing.sourceName) {
    return playing.sourceName;
  }
  const raw = playing.sourceId || playing.contentSource;
  if (!raw) {
    return '';
  }
  return raw
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @description "Now playing" and "Artist" texts.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language.
 * @returns {{ title: string, artist: string }} Texts (never empty).
 */
export function playingTexts(entry, language) {
  if (entry.on === false) {
    return { title: text('standby', language), artist: NOTHING };
  }
  const playing = entry.nowPlaying ?? {};
  const value = sourceValue(entry);
  if (value === 'tv') {
    return { title: text('source_tv', language), artist: NOTHING };
  }
  const title = playing.title || sourceLabel(entry, language) || NOTHING;
  return {
    title: title.slice(0, MAX_TEXT),
    artist: (playing.artist || NOTHING).slice(0, MAX_TEXT),
  };
}

/**
 * @description Feature values of a speaker: a number, or `{ text }`. Only
 * what is known.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language of the texts.
 * @returns {Array<[string, number|{ text: string }]>} `[key, value]` pairs.
 */
export function featureValues(entry, language) {
  const values = [];
  if (entry.on !== null && entry.on !== undefined) {
    values.push([FEATURE_KEYS.POWER, entry.on ? 1 : 0]);
  }
  if (Number.isFinite(entry.volume)) {
    values.push([FEATURE_KEYS.VOLUME, entry.volume]);
  }
  if (typeof entry.muted === 'boolean') {
    values.push([FEATURE_KEYS.MUTE, entry.muted ? 1 : 0]);
  }
  if (entry.nowPlaying || entry.on === false) {
    // The playback state goes with the music features (nowPlayingOf).
    values.push([FEATURE_KEYS.SOURCE, { text: sourceValue(entry) }]);
    const { title, artist } = playingTexts(entry, language);
    values.push([FEATURE_KEYS.TITLE, { text: title }]);
    values.push([FEATURE_KEYS.ARTIST, { text: artist }]);
  }
  for (const key of Object.keys(AUDIO_SETTINGS)) {
    const setting = entry.audio?.[key];
    if (setting && settingOptions(setting)) {
      values.push([key, { text: settingValue(setting) }]);
    }
  }
  if (entry.mode?.value && entry.mode.options?.length > 1) {
    values.push([FEATURE_KEYS.AUDIO_MODE, { text: entry.mode.value }]);
  }
  if (Number.isFinite(entry.battery?.percent)) {
    values.push([FEATURE_KEYS.BATTERY, entry.battery.percent]);
    values.push([FEATURE_KEYS.CHARGING, entry.battery.charging ? 1 : 0]);
  }
  return values;
}

/** The feature external ids publishNowPlaying writes to, by `music` type. */
export const NOW_PLAYING_KEYS = {
  [TYPES.MUSIC.PLAYBACK_STATE]: FEATURE_KEYS.PLAYBACK,
  [TYPES.MUSIC.TITLE]: FEATURE_KEYS.MUSIC_TITLE,
  [TYPES.MUSIC.ARTIST]: FEATURE_KEYS.MUSIC_ARTIST,
  [TYPES.MUSIC.ALBUM]: FEATURE_KEYS.ALBUM,
  [TYPES.MUSIC.ARTWORK]: FEATURE_KEYS.ARTWORK,
  [TYPES.MUSIC.DURATION]: FEATURE_KEYS.DURATION,
  [TYPES.MUSIC.POSITION]: FEATURE_KEYS.POSITION,
  [TYPES.MUSIC.MUTE]: FEATURE_KEYS.MUSIC_MUTE,
};

/**
 * @description What the speaker plays, as a publishNowPlaying snapshot
 * (the volume stays with the other states). Cleared texts are explicit
 * empty strings: an absent key would leave the previous track on screen.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language (the "TV" title).
 * @returns {object|null} The snapshot, null when nothing is known yet.
 */
export function nowPlayingOf(entry, language) {
  const snapshot = {};
  if (typeof entry.muted === 'boolean') {
    snapshot.mute = entry.muted;
  }
  const playing = entry.nowPlaying;
  if (entry.on === false || playing) {
    const loaded = entry.on !== false && playing;
    const tv = loaded && sourceValue(entry) === 'tv';
    const track = loaded && !tv;
    const duration = track ? (playing.duration ?? 0) : 0;
    const position = track ? (playing.position ?? 0) : 0;
    Object.assign(snapshot, {
      playback_state:
        loaded && playing.playing ? MUSIC_PLAYBACK_STATE.PLAYING : MUSIC_PLAYBACK_STATE.PAUSED,
      title: tv
        ? text('source_tv', language)
        : track
          ? playing.title || sourceLabel(entry, language)
          : '',
      artist: track ? playing.artist : '',
      album: track ? playing.album : '',
      artwork_url: track && /^https:\/\//i.test(playing.art) ? playing.art : null,
      duration: Math.min(duration, MAX_SECONDS),
      position: Math.min(duration > 0 ? Math.min(position, duration) : position, MAX_SECONDS),
    });
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

/**
 * @description The presets of a speaker as music catalog items (the
 * "browse" panel of the Music box): the id is the source value, played
 * back by sourceCommand.
 * @param {object} entry - Speaker entry.
 * @param {string} language - Language.
 * @param {Function} artworkKey - `(url) => key` of the SDK client.
 * @returns {object[]} MediaItems, by preset number.
 */
export function presetItems(entry, language, artworkKey) {
  return (entry.presets ?? []).map((preset) => {
    const art = preset.content.containerArt;
    return {
      id: presetValue(preset.id),
      type: RADIO_SOURCES.has(preset.content.source)
        ? MUSIC_MEDIA_TYPES.RADIO
        : MUSIC_MEDIA_TYPES.PLAYLIST,
      title: (preset.name || `${text('preset', language)} ${preset.id}`).slice(0, MAX_TEXT),
      subtitle: `${text('preset', language)} ${preset.id}`,
      ...(typeof art === 'string' && /^https:\/\//i.test(art)
        ? { artwork_key: artworkKey(art) }
        : {}),
      browsable: false,
      playable: true,
    };
  });
}

/**
 * @description What a Gladys command does on the speaker.
 * @param {object} entry - Speaker entry.
 * @param {string} key - Feature key.
 * @param {number|string} value - Value sent by Gladys.
 * @returns {object|null} `{ resource, method, body, applyAs }`, or null when
 * there is nothing to do (`other` picked in the select).
 * @throws {RangeError} On a value the feature does not take.
 */
export function commandFor(entry, key, value) {
  switch (key) {
    case FEATURE_KEYS.POWER:
      return {
        resource: '/system/power/control',
        method: 'POST',
        body: { power: Number(value) === 1 ? 'ON' : 'OFF' },
        applyAs: '/system/power/control',
        assume: { on: Number(value) === 1 },
      };
    case FEATURE_KEYS.VOLUME: {
      const level = Math.round(Number(value));
      if (!Number.isFinite(level)) {
        throw new RangeError(String(value));
      }
      return {
        resource: '/audio/volume',
        method: 'PUT',
        body: { value: Math.min(100, Math.max(0, level)) },
        applyAs: '/audio/volume',
      };
    }
    case FEATURE_KEYS.MUTE:
    case FEATURE_KEYS.MUSIC_MUTE:
      return {
        resource: '/audio/volume',
        method: 'PUT',
        body: { muted: Number(value) === 1 },
        applyAs: '/audio/volume',
      };
    case FEATURE_KEYS.PLAY:
    case FEATURE_KEYS.PAUSE:
    case FEATURE_KEYS.NEXT:
    case FEATURE_KEYS.PREVIOUS: {
      const state = { play: 'PLAY', pause: 'PAUSE', next: 'SKIPNEXT', previous: 'SKIPPREVIOUS' }[
        key
      ];
      return {
        resource: '/content/transportControl',
        method: 'PUT',
        body: { state },
        applyAs: '/content/nowPlaying',
      };
    }
    case FEATURE_KEYS.PLAYBACK: {
      const state = {
        [MUSIC_PLAYBACK_STATE.PAUSED]: 'PAUSE',
        [MUSIC_PLAYBACK_STATE.PLAYING]: 'PLAY',
      }[Number(value)];
      if (!state) {
        throw new RangeError(String(value));
      }
      return {
        resource: '/content/transportControl',
        method: 'PUT',
        body: { state },
        applyAs: '/content/nowPlaying',
      };
    }
    case FEATURE_KEYS.POSITION: {
      const position = Math.round(Number(value));
      if (!Number.isFinite(position) || position < 0 || position > MAX_SECONDS) {
        throw new RangeError(String(value));
      }
      return {
        resource: '/content/transportControl',
        method: 'PUT',
        body: { state: 'SEEK', position },
        applyAs: '/content/nowPlaying',
      };
    }
    case FEATURE_KEYS.SOURCE:
      return sourceCommand(entry, String(value));
    case FEATURE_KEYS.AUDIO_MODE: {
      const mode = String(value);
      if (!entry.mode?.options?.includes(mode)) {
        throw new RangeError(mode);
      }
      return {
        resource: '/audio/mode',
        method: 'POST',
        body: { value: mode },
        applyAs: '/audio/mode',
      };
    }
    default: {
      const resource = AUDIO_SETTINGS[key];
      const setting = entry.audio?.[key];
      const number = Number(value);
      if (!resource || !setting) {
        throw new RangeError(key);
      }
      if (!Number.isInteger(number) || number < setting.min || number > setting.max) {
        throw new RangeError(String(value));
      }
      return { resource, method: 'POST', body: { value: number }, applyAs: resource };
    }
  }
}

/**
 * @description The playback request of a source value.
 * @param {object} entry - Speaker entry.
 * @param {string} value - Value of the select.
 * @param {string} [personId] - Bose person id (initiator of a preset).
 * @returns {object|null} The command, null for `other`.
 */
export function sourceCommand(entry, value, personId = '') {
  if (value === SOURCE_OTHER) {
    return null;
  }
  if (INPUTS[value]) {
    return {
      resource: '/content/playbackRequest',
      method: 'POST',
      body: { source: INPUTS[value].source, sourceAccount: INPUTS[value].account },
      applyAs: '/content/nowPlaying',
    };
  }
  const id = /^preset-(\d{1,2})$/.exec(value)?.[1];
  const preset = id ? (entry.presets ?? []).find((candidate) => candidate.id === id) : null;
  if (!preset) {
    throw new RangeError(value);
  }
  return presetCommand(preset, personId);
}

/**
 * @description The playback request of a preset.
 * @param {object} preset - parsePresets() item.
 * @param {string} personId - Bose person id.
 * @returns {object} The command.
 */
export function presetCommand(preset, personId) {
  const content = preset.content;
  return {
    resource: '/content/playbackRequest',
    method: 'POST',
    body: {
      source: content.source,
      initiatorID: personId,
      sourceAccount: content.sourceAccount,
      preset: {
        location: content.location,
        name: content.name,
        containerArt: content.containerArt,
        presetable: content.presetable,
        type: content.type,
      },
    },
    applyAs: '/content/nowPlaying',
  };
}
