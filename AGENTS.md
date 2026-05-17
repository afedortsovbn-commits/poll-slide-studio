# Poll Slide Studio Agent Notes

## Commands

- Install: `npm.cmd install`
- Dev: `npm.cmd run dev`
- Lint: `npm.cmd run lint`
- Build: `npm.cmd run build`
- Preview: `npm.cmd run preview`

## Product Rules

- Admin and speaker views target desktop.
- Participant poll views target mobile portrait.
- Slides use 16:9 layout with a 1920x1080 authoring target.
- Speaker next action on an active poll first closes voting and reveals results; the next action advances.
- Presenter controls must support `ArrowRight`, `ArrowLeft`, `PageDown`, `PageUp`, `Space`, `Enter`, and `Backspace`.
- GitHub Pages is the static host. Real multi-network voting needs a realtime backend adapter.

## Verification

Before delivery, run lint and build, then verify admin, speaker, and participant routes in the in-app Browser.
