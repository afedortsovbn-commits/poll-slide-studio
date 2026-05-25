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

## Telegram Delivery

Этот проект использует общий Telegram-мост рабочей папки Codex:

`E:\CodexProj\codex-telegram.ps1`

Codex должен по умолчанию использовать мост для уведомлений о завершении этапов, запросов локальных разрешений, уведомлений о системных approval Codex, отправки ссылок и файлов, а также чтения входящих Telegram-задач для этого проекта.

Типовые команды из корня проекта:

```powershell
E:\CodexProj\codex-telegram.ps1 notify --message "Этап завершен"
E:\CodexProj\codex-telegram.ps1 request-approval --title "Запуск проверки" --details "Нужно выполнить команду для проекта"
E:\CodexProj\codex-telegram.ps1 codex-approval-needed --title "Sandbox approval" --details "Подтверждение возможно только в интерфейсе Codex"
E:\CodexProj\codex-telegram.ps1 check-similar --title "Запуск проверки"
E:\CodexProj\codex-telegram.ps1 read-inbox --limit 20
E:\CodexProj\codex-telegram.ps1 open-tasks --limit 20
E:\CodexProj\codex-telegram.ps1 send-link --title "Готовая ссылка" --url "https://example.com"
```

Перед повторяющимся действием сначала проверять сохраненное согласие через `check-similar`. Системные approval Codex все равно запрашиваются через интерфейс Codex; если Telegram-согласование невозможно, сначала отправить уведомление через `codex-approval-needed`.

Когда пришла Telegram-задача, поставить ей статус `started`, выполнить работу в проекте, запустить доступные проверки, отправить краткий статус через `notify`, затем поставить статус `done`.
