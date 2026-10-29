# Win11 Web

브라우저 안에서 동작하는 윈도우 11 스타일 데스크톱입니다. 바탕 화면 아이콘으로 앱과 게임을 창으로 열고, 각 앱은 고유 주소로 따로 열 수도 있습니다.

## 실행

Node.js 22 이상이 필요합니다. Windows PowerShell에서는 `npm.cmd`를 사용하세요.

```powershell
npm.cmd start          # http://localhost:3100
npm.cmd test           # 프록시 단위 테스트
npm.cmd install        # (처음 한 번) Playwright 설치
node tests/smoke.mjs   # 브라우저 스모크 테스트 + 스크린샷 (서버 실행 중일 때)
```

## 주소

| 주소 | 내용 |
|---|---|
| `/` | 데스크톱 |
| `/?open=webkart` | 데스크톱을 열고 웹 카트 창 띄우기 (쉼표로 여러 개: `/?open=notepad,calculator`) |
| `/apps/<id>/` | 앱 단독 페이지 (`explorer`, `chrome`, `notepad`, `terminal`, `photos`, `calculator`, `paint`, `settings`, `webkart`, `gostop`, `shooter`, `typing`, `snake`, `breakout`, `memory`) |
| `/apps/chrome/?url=example.com` | 크롬 앱에서 바로 사이트 열기 |

## 데스크톱 기능

부팅·잠금 화면(세션당 한 번), 끌어서 옮기는 바탕 화면 아이콘(위치 저장), 시작 메뉴(검색·최근 사용·잠금/다시 시작), 작업 표시줄 고정과 우클릭 메뉴, 빠른 설정(다크 모드·야간 모드·전체 화면·밝기), 알림 센터와 달력, 창 드래그·크기 조절·가장자리 스냅, 최대화 버튼에 마우스를 올리면 나오는 창 배치(Snap Layouts).

## 구조

- `server.mjs` — 정적 파일, `/proxy`, `/config.json`, `/healthz`
- `proxy.mjs` — 크롬 앱용 프록시 (연결 재사용, 정적 파일 10분 캐시)
- `youtube.mjs` — 크롬 앱의 YouTube 보기용 검색 (`/yt/search?q=`). YouTube는 프록시로 동작하지 않아 검색 결과를 서버에서 읽고, 재생은 YouTube 임베드 플레이어로 합니다
- `public/shell/` — 데스크톱, 창 관리자, 작업 표시줄, 시작 메뉴
- `public/apps/registry.json` — 앱 목록. 새 앱은 여기에 한 줄 추가하고 `public/apps/<id>/index.html`을 만들면 됩니다. 규칙은 `APP_CONTRACT.md` 참고.

## 온라인 체스

체스 앱에서 상대를 '온라인'으로 고르고 방을 만든 뒤 6자리 코드나 초대 링크(`/apps/chess/?room=코드`)를 친구에게 보내면 됩니다. 서버(`chess-online.mjs`)가 모든 수를 `rules.js`로 검사하고 Server-Sent Events로 두 사람에게 실시간 전달합니다. 세 번째로 들어온 사람은 관전합니다. 대국이 끝나면 둘 다 재대결을 누를 때 색을 바꿔 새 게임이 시작됩니다. 방은 서버 메모리에만 있어서 서버가 재시작되면 사라집니다.

`node tests/chess-online.e2e.cjs [주소]`는 브라우저 두 개로 실제 대국을 진행해 확인합니다.

## 크롬 앱과 프록시

외부 사이트는 서버가 대신 받아 링크를 `/proxy?url=...`로 바꿔서 보여줍니다. 공개 서버라서 다음 제한이 있습니다.

- http/https만 허용, 내부망·루프백 주소 차단(접속 시점 DNS 검사로 리바인딩 방지)
- IP당 분당 240요청, 응답 8MB, 15초 제한, 쿠키 미전달, GET만 지원
- 프록시된 페이지는 샌드박스(별도 출처)에서 실행되어 이 사이트의 저장소에 접근할 수 없습니다

그래서 로그인, 동영상 재생, 스크립트로 주소를 만드는 복잡한 사이트는 제대로 동작하지 않을 수 있습니다. 크롬 앱 오른쪽 위 버튼으로 실제 브라우저에서 열 수 있습니다.

## 고스톱 연동

고스톱은 `gostop-next`(화투클럽)를 iframe으로 띄웁니다. 주소는 환경 변수 `GOSTOP_URL`(기본값 `http://localhost:3000`)로 정합니다. 사이트를 https로 배포하면 화투클럽도 https 주소여야 합니다.

## Render 배포

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Render에서 Blueprint로 `render.yaml`을 불러옵니다.
3. `GOSTOP_URL`에 배포된 화투클럽 주소를 넣습니다 (예: `https://hwatu-club.onrender.com`).

현재 배포: https://win11-web-64by.onrender.com/ — Render가 GitHub와 연결되어 `main`에 푸시하면 자동 배포됩니다. `/healthz`는 배포된 커밋을 알려줍니다.
