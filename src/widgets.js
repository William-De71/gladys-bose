// -----------------------------------------------------------------------------
// Dashboard widget.
//
//   now_playing   one speaker (setting `device`): what is playing with the
//                 cover when the music service gives one, the state, the
//                 source, the volume, the battery and the group, and the
//                 buttons previous / play-pause / next / standby (or "Turn
//                 on" in standby)
//
// Pure: the build function turns a snapshot into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { t, truncate } from './i18n.js';

export const WIDGETS = { NOW_PLAYING: 'now_playing' };
export const WIDGET_ACTIONS = {
  PREVIOUS: 'previous',
  PLAY: 'play',
  PAUSE: 'pause',
  NEXT: 'next',
  POWER_ON: 'power_on',
  POWER_OFF: 'power_off',
};
export const TTL_SECONDS = 60;

/**
 * @typedef {object} SpeakerView
 * @property {string} deviceId - Gladys external id.
 * @property {string} name - Device name in Gladys.
 * @property {boolean} reachable - Connected.
 * @property {boolean} on - Not in standby.
 * @property {string} status - PLAY, PAUSED, STOPPED, BUFFERING or ''.
 * @property {string} title - Track, or what plays.
 * @property {string} artist - Artist ('' when none).
 * @property {string} source - Name of the source ('' when none).
 * @property {number|null} volume - 0-100.
 * @property {boolean} muted - Muted.
 * @property {{ percent: number, charging: boolean }|null} battery - Portable speakers.
 * @property {object|null} group - `{ leads: number }` or `{ follows: string }`.
 * @property {string} [image] - Image key of the cover.
 */

const stateOf = (view) => {
  if (!view.reachable) {
    return { key: 'widgetUnreachable', color: 'danger' };
  }
  if (!view.on) {
    return { key: 'widgetStandby', color: 'neutral' };
  }
  if (view.status === 'PLAY' || view.status === 'BUFFERING') {
    return { key: 'widgetPlaying', color: 'success' };
  }
  return view.status === 'PAUSED'
    ? { key: 'widgetPaused', color: 'warning' }
    : { key: 'widgetIdle', color: 'info' };
};

/**
 * @description The `now_playing` widget.
 * @param {SpeakerView|null} view - The speaker, null when the setting points nowhere.
 * @returns {object} The widget content.
 */
export function buildNowPlayingWidget(view) {
  if (!view) {
    return {
      version: 1,
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetChooseDevice'), variant: 'caption' }],
    };
  }
  const state = stateOf(view);
  const active = view.reachable && view.on;
  let body;
  if (!view.reachable) {
    body = t('widgetOffline');
  } else if (!view.on) {
    body = t('widgetStandby');
  } else if (view.title) {
    const line = view.artist ? `${view.title} — ${view.artist}` : view.title;
    body = truncate(line, 300);
  } else {
    body = t('widgetNothing');
  }
  const components = [
    { type: 'text', text: truncate(view.name, 40), variant: 'heading' },
    { type: 'text', text: body, variant: 'body' },
  ];
  if (active && view.image) {
    components.push({ type: 'image', key: view.image, alt: t('widgetArt'), fit: 'contain' });
  }
  const items = [{ label: t('widgetState'), value: t(state.key), color: state.color }];
  if (active && view.source) {
    items.push({ label: t('widgetSource'), value: truncate(view.source, 40), color: 'neutral' });
  }
  if (view.reachable && Number.isFinite(view.volume)) {
    items.push(
      view.muted
        ? { label: t('widgetVolume'), value: t('widgetMutedValue'), color: 'warning' }
        : { label: t('widgetVolume'), value: view.volume, color: 'primary' },
    );
  }
  if (view.reachable && Number.isFinite(view.battery?.percent)) {
    const percent = view.battery.percent;
    items.push({
      label: t('widgetBattery'),
      value: view.battery.charging ? t('widgetCharging', { percent }) : `${percent} %`,
      color: percent <= 15 ? 'danger' : percent <= 30 ? 'warning' : 'success',
    });
  }
  if (active && view.group) {
    items.push({
      label: t('widgetGroup'),
      value:
        view.group.follows !== undefined
          ? t('widgetGroupFollows', { name: truncate(view.group.follows, 24) })
          : t('widgetGroupLeads', { count: view.group.leads }),
      color: 'info',
    });
  }
  components.push({ type: 'status', items });
  const params = { device: view.deviceId };
  if (active) {
    const playing = view.status === 'PLAY' || view.status === 'BUFFERING';
    components.push(
      {
        type: 'button',
        label: t('widgetPrevious'),
        icon: 'skip-back',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.PREVIOUS, params },
      },
      {
        type: 'button',
        label: playing ? t('widgetPause') : t('widgetPlay'),
        icon: playing ? 'pause' : 'play',
        style: 'primary',
        action: { key: playing ? WIDGET_ACTIONS.PAUSE : WIDGET_ACTIONS.PLAY, params },
      },
      {
        type: 'button',
        label: t('widgetNext'),
        icon: 'skip-forward',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.NEXT, params },
      },
      {
        type: 'button',
        label: t('widgetPowerOff'),
        icon: 'power',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.POWER_OFF, params },
      },
    );
  } else if (view.reachable) {
    components.push({
      type: 'button',
      label: t('widgetPowerOn'),
      icon: 'power',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.POWER_ON, params },
    });
  }
  return { version: 1, ttl_seconds: TTL_SECONDS, components };
}
