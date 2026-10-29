# App contract

Every app lives in `public/apps/<id>/` and is a standalone web page. The desktop shell
opens it inside an iframe window, and users can also open `/apps/<id>/` directly.

Rules:
- Only touch files inside your own `public/apps/<id>/` folder.
- Entry file is `public/apps/<id>/index.html`. Extra JS/CSS files go in the same folder.
- In `<head>` include, in this order:
  ```html
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/shared/app.css">
  <script type="module" src="/shared/theme.js"></script>
  ```
- Use the CSS variables from `public/shared/app.css` (`--bg`, `--surface`, `--text`, `--accent`,
  `--border`, `--radius`, ...) and its `.btn`, `.input`, `.toolbar`, `.card` classes so the app
  follows light/dark theme.
- No external network requests: no CDNs, no web fonts, no remote images. Vanilla JS (ES modules) only.
- Fill the viewport (`html, body` 100% height) and stay usable from 320px to 1400px wide.
  Re-layout on `resize`.
- Persist state in `localStorage` with keys prefixed `win11web.<id>.`; wrap access in try/catch.
- Games: keyboard controls plus touch/pointer controls, a pause on `visibilitychange`/blur,
  a visible score/HUD, and a restart button. Games must be original designs, not recreations of
  specific commercial games.
- Shared virtual file system (Explorer, Notepad, Paint): `localStorage` key `win11web.fs`, JSON
  `{ "files": { "<path>": { "type": "text" | "image", "content": "<text or dataURL>", "modified": <ms> } } }`
  with paths like `/문서/메모.txt`, `/사진/그림.png`. Default folders: `/문서`, `/사진`, `/바탕 화면`.
  Notepad/Paint accept `?file=<path>` to open a file.
- Theme setting: `localStorage['win11web.theme'] = 'light' | 'dark'`.
  Wallpaper setting: `localStorage['win11web.wallpaper'] = '<preset id>'` (presets: `bloom`, `glow`, `sunrise`, `night`).
  The shell listens for `storage` events, so writing these keys is enough.
- Talking to the desktop (only when `window.parent !== window`), always with `location.origin` as target:
  `{ type: 'win11web-open', id: '<app id>', url?: '/apps/<id>/...' }` opens an app window, optionally at a deeper
  page of that same app; `{ type: 'win11web-notify', title, body }` shows a notification toast.
