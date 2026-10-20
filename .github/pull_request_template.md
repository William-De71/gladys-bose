<!--
The TITLE of this pull request becomes the squash commit, then the line users
read in CHANGELOG.md and in the GitHub Release. Write it in English, as a
Conventional Commit describing the change for the user:

  feat(effects): add the music mode of the strips with a microphone
  fix(devices): keep the brightness when the colour changes
  feat(widgets): show the colour of each light in the list
  docs: explain how to reach a device on another subnet

feat -> minor version, fix / perf -> patch, `!` or a "BREAKING CHANGE:" footer
-> breaking (a minor while the version is below 1.0.0). docs, chore, ci, test,
style, refactor and build alone publish no release. Never edit CHANGELOG.md.
-->

## What changes for the user

## How it was tested

- [ ] `npm run format:check`, `npm run lint` and `npm test` pass
- [ ] Tried with a real speaker (model, `BOSE_FIRMWARE`):
- [ ] Widget content changed: `docs/illustrations/render.sh` run again
- [ ] The four docs (`docs/en.md`, `fr`, `de`, `es`) and READMEs are up to date
