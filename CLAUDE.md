# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the recent Bose smart speakers
and soundbars (the ones set up with the Bose app, "passport" products): a
Node.js service (Node 22+, ESM, no build step; dependencies: the SDK and `ws`)
in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
to the speakers **on the local network** and to the Bose cloud **only for the
account token** (`transports: ["local"]`).

A **device integration** (`type: "device"`, Gladys 5.1.0+: widget and scenes).
The protocol is reverse-engineered and implemented in `src/bose/` from the
descriptions of [pybose](https://github.com/cavefire/pybose) and of the
[Home Assistant integration](https://github.com/cavefire/Bose-Homeassistant):
both are **GPL-3.0, reference only, never copy their code**. The older
SoundTouch range (port 8090) is another integration (guim31/gladys-soundtouch).

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "groups"  # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from cover.svg (Inkscape, ImageMagick)
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, commands, scene events and actions, widget, status
src/hub.js                   the speakers and their connections: subscribe, apply pushes, heartbeat, reconnect
src/account.js               Bose account token: /data/account.json, refresh, sign-in, backoff
src/devices.js               speaker -> Gladys device (features), values, commands
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, event data, outputs
src/widgets.js               the `now_playing` widget (pure, reused by docs/illustrations)
src/art.js                   cover art download (https, ≤ 300 KB, magic numbers), keys by hash
src/i18n.js                  runtime texts in en / fr / de / es
src/storage.js               JSON files in /data (account.json, speakers.json)
src/config.js                config_schema -> { email, password, hosts, rescanMs, language }
src/bose/connection.js       WebSocket client: wss :8082, eco2, GUID, reqID, NOTIFY, timeouts
src/bose/auth.js             Bose sign-in (Azure AD B2C pages + id.api.bose.io), refresh
src/bose/model.js            parsers of the speaker bodies
src/bose/discovery.js        mediated mDNS scan, GUID from TXT, typed addresses
test/helpers/                fake speakers (real ws servers) and fake Bose cloud (fake fetch)
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:speaker:{GUID}` (lowercased)
  and `…:<feature key>` (`power`, `volume`, `mute`, `play`, `pause`,
  `previous`, `next`, `playback-state`, `source`, `title`, `artist`, `bass`,
  `midrange`, `treble`, `center`, `surround`, `height`, `subwoofer`,
  `audio-mode`, `battery`, `charging`). Source values (`other`, `tv`,
  `optical`, `analog`, `aux`, `preset-<n>`), config, action, field, widget,
  trigger, variable and output keys too.
- **The GUID in request headers** is the one the speaker writes (first
  message, `reportedGuid`), never the normalized one.
- **Feature fields** compared by the Discover "Update" (category, type,
  unit, min, max, step, features added or removed): the baseline pins them.
  Only read-in-full speakers (`entry.ready`) are published to Discover.
- **Secrets**: never log the password, a token, or a whole request header.
  `test/app.test.js` checks the logs. A refused password is never retried on
  its own (account lockout).
- **No polling**: the speakers push (`PUT /subscription`, version 2). Only a
  liveness GET every minute and the battery every 5 min.
- **Scene events**: one per transition, never in the 5 s after a scene action
  on the speaker (`quietUntil`).
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 image, 1 status, 4 buttons.
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag.
- **Changelog**: Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.

## Pitfalls

- Container behind the Docker bridge: discovery goes through
  `scanNetwork('mdns')` (`_bose-passport._tcp`, declared in
  `network_discovery`). The mDNS port is not the WebSocket port: always 8082.
- A speaker stays silent about a resource it lacks: every request has a
  timeout, and the unlisted sound settings are probed once (5 s).
- A fresh token can be refused "JWT not before" by a speaker whose clock is
  late: retried 3 times, 2 s apart.
- A connection can drop during the initial read: `connectOnce` fails then, so
  the retry logic runs (a test pins it).
- The B2C sign-in answers HTTP 200 with `{"status":"400"}` on a wrong
  password; the final page redirects to `bosemusic://auth/callback?code=…`.
- Gladys does not send the user's language with a scan or a command: feature
  names, select labels and scene errors use the `language` setting.
- Never tested on a real speaker nor a real Bose account: when a user reports
  a difference, fix the fakes in `test/helpers/` first, then the code.
