# Poll Slide Studio

Интерактивная браузерная презентация с админкой, режимом показа, QR-опросами и голосованием участников.

Репозиторий: `poll-slide-studio`

GitHub Pages:

```text
https://afedortsovbn-commits.github.io/poll-slide-studio/
```

## Ссылки

- Админка: `#/admin`
- Показ презентации: `#/present`
- Опрос участника: `#/poll/<slide-id>`

## Команды

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

## Режим данных

Без Firebase приложение работает локально через `localStorage`. Это удобно для настройки интерфейса и проверки на одном компьютере.

Если задать Firebase-конфигурацию, включается realtime-режим:

- админка сохраняет презентацию в Firestore;
- спикер открывает и закрывает опросы в Firestore;
- участники отправляют ответы в Firestore;
- экран спикера получает реальные ответы и показывает результаты.

## Настройка Firebase

1. Создать проект в Firebase.
2. Создать Web App внутри проекта.
3. Включить Firestore Database.
4. Скопировать параметры web config в файл `.env` по примеру `.env.example`.
5. Собрать проект заново командой `npm.cmd run build`.
6. Опубликовать обновленный `docs/` на GitHub Pages.

Firebase web config не является паролем, но без него публичная сборка не сможет подключиться к Firestore.

Минимальные правила Firestore для демонстрационного режима:

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /pollSlideStudio/{document=**} {
      allow read, write: if true;
    }

    match /pollSlideStudioVotes/{document=**} {
      allow read, write: if true;
    }
  }
}
```

Эти правила открытые: они подходят для первой рабочей проверки, но не защищают от намеренного изменения данных посторонним человеком. Для публичного продукта нужно добавить Firebase Auth, App Check и более строгие правила.

## Проверка перед сдачей

- `npm.cmd run lint`
- `npm.cmd run build`
- открыть админку на desktop;
- открыть показ на desktop;
- открыть опрос участника на mobile viewport;
- проверить, что нет пустых экранов, ошибок и сломанной верстки.
