# Poll Slide Studio

Interactive presentation builder for browser-based slides, QR polls, presenter controls, and participant voting.

Repository name: `poll-slide-studio`

GitHub Pages URL:

```text
https://afedortsovbn-commits.github.io/poll-slide-studio/
```

## Commands

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

## Current Data Mode

The first milestone uses browser `localStorage` for presentation data and demo voting. This is enough for interface development, export/import, and local validation.

For real voting from any network, connect a realtime backend such as Supabase while keeping GitHub Pages as the static host.

## Routes

- `#/admin` - admin workspace.
- `#/present` - speaker view.
- `#/poll/<slide-id>` - participant voting view.

## Verification Checklist

- Build passes.
- Lint passes.
- Admin works on desktop viewports.
- Speaker controls support keyboard, presenter clickers, and result reveal.
- Participant view works on mobile portrait viewports.
