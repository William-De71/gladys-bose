// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers`, `scene_actions`).
//
// Triggers: one event per transition the speaker pushes, never a snapshot.
//
//   playback_started     a speaker starts playing (from stopped, paused or standby)
//   playback_stopped     it stops playing (pause, stop, standby)
//   source_changed       it switches to another source (TV, optical, a preset…)
//   speaker_unreachable  it stopped answering for a minute (unplugged, Wi-Fi lost)
//
// Actions: operations with parameters, which a device feature cannot carry.
//
//   play_preset      play preset 1 to 6 of the Bose app (output: preset_name)
//   group_speakers   group speakers around a leader (output: group_size)
//   ungroup_speaker  take a speaker out of its group (the whole group when
//                    it is the leader)
//
// No event is fired in the five seconds after a scene action acted on a
// speaker: a scene never triggers itself.
// -----------------------------------------------------------------------------

export const SCENE_TRIGGERS = {
  PLAYBACK_STARTED: 'playback_started',
  PLAYBACK_STOPPED: 'playback_stopped',
  SOURCE_CHANGED: 'source_changed',
  SPEAKER_UNREACHABLE: 'speaker_unreachable',
};

// The data keys of each event, as declared in the manifest (fields and variables).
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.PLAYBACK_STARTED]: ['device', 'device_name', 'title', 'artist', 'source'],
  [SCENE_TRIGGERS.PLAYBACK_STOPPED]: ['device', 'device_name', 'title', 'artist', 'source'],
  [SCENE_TRIGGERS.SOURCE_CHANGED]: [
    'device',
    'device_name',
    'source',
    'source_name',
    'previous_source',
  ],
  [SCENE_TRIGGERS.SPEAKER_UNREACHABLE]: ['device', 'device_name', 'address'],
};

export const SCENE_ACTIONS = {
  PLAY_PRESET: 'play_preset',
  GROUP_SPEAKERS: 'group_speakers',
  UNGROUP_SPEAKER: 'ungroup_speaker',
};

// The outputs each action returns, as declared in the manifest.
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.PLAY_PRESET]: ['preset_name'],
  [SCENE_ACTIONS.GROUP_SPEAKERS]: ['group_size'],
  [SCENE_ACTIONS.UNGROUP_SPEAKER]: [],
};

export const PRESET_NUMBERS = ['1', '2', '3', '4', '5', '6'];
// Values of the source filter of `source_changed` (the source select values).
export const SOURCE_FILTER_VALUES = [
  'tv',
  'optical',
  'analog',
  'aux',
  ...PRESET_NUMBERS.map((id) => `preset-${id}`),
  'other',
];
