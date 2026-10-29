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
| `/apps/<id>/` | 앱 단독 페이지 (`explorer`, `chrome`, `notepad`, `terminal`, `photos`, `calculator`, `paint`, `settings`, `pc`, `webkart`, `classicube`, `balloon`, `gostop`, `shooter`, `typing`, `snake`, `breakout`, `memory`) |
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

## 가상 PC (v86)

`/apps/pc/` — 브라우저 안에서 x86 PC를 에뮬레이션합니다([v86](https://github.com/copy/v86), WebAssembly JIT). `public/vendor/v86/`에 에뮬레이터와 BIOS가 들어 있습니다.

- **FreeDOS / KolibriOS / Linux**: 자유 소프트웨어 이미지는 서버가 처음 한 번 미러(`PC_IMAGE_BASE`, 기본 `https://i.copy.sh/`)에서 받아 캐시한 뒤 이 사이트 주소로 내려줍니다(`/api/pc/image/<id>`).
- **EXE·ZIP 넣기**: 파일을 끌어다 놓으면 브라우저에서 FAT16 하드 디스크 이미지를 만들어 붙입니다(`disk.js`, 긴 파일 이름 지원). ZIP은 내장 `DecompressionStream`으로 풉니다. FreeDOS에서는 C: 드라이브가 되고, 부팅되면 자동으로 C:로 이동합니다. DOS용 EXE와 Windows용(PE) EXE를 구분해서 알려 줍니다.
- **내 디스크 이미지**: Windows 95/98, MS-DOS처럼 직접 가진 이미지(.img/.iso)는 업로드 없이 브라우저 안에서만 읽어서 부팅합니다. 이때 넣은 파일은 두 번째 디스크(D:)가 됩니다. Windows용 EXE는 이렇게 실행합니다.
- 상태 저장/불러오기(IndexedDB), 스크린샷(사진 폴더에 저장), Ctrl+Alt+Del, 마우스 잠금, 전체 화면, 텍스트 입력.

GPU 가속이나 QEMU는 브라우저에서 쓸 수 없습니다(WebAssembly에는 하드웨어 가상화와 GPU 패스스루가 없음). 그래서 v86으로는 DOS·Windows 9x 시절 프로그램까지가 현실적이고, 자바 마인크래프트 같은 3D 게임은 아래 ClassiCube처럼 웹용으로 만들어진 클라이언트를 씁니다.

## ClassiCube (마인크래프트 클래식 호환 멀티)

`/apps/classicube/` — 오픈 소스 [ClassiCube](https://github.com/ClassiCube/ClassiCube) 웹 클라이언트(WebGL)로 마인크래프트 클래식 0.30 프로토콜 게임을 합니다. 멀티플레이 서버는 이 사이트에 직접 있습니다.

- `classic/server.mjs` — 클래식 프로토콜 7 서버: 월드 전송(gzip), 블록 설치/파괴 검증(거리·속도·설치 가능 블록), 이동 중계, 채팅과 `/help` `/who` `/tp` `/spawn` `/me`, 같은 이름 재접속 처리, IP당 접속 제한
- `websocket.mjs` — 의존성 없는 WebSocket 구현. 웹 클라이언트는 `wss://<사이트>:443/`에 `ClassiCube` 하위 프로토콜로 접속합니다. `CLASSIC_TCP_PORT`를 정하면 데스크톱 ClassiCube용 TCP 포트도 엽니다.
- `classic/world.mjs` — 시드 기반 지형(언덕·호수·모래사장·광석·나무) 128×64×128. `CLASSIC_DATA` 폴더에 1분마다, 그리고 종료(SIGTERM) 때 저장합니다. render.yaml은 1GB 디스크를 붙여 배포해도 월드가 남습니다.
- 게임 프로그램(ClassiCube.js)은 플레이할 때 cs.classicube.net에서 받고, 기본 텍스처(`/static/default.zip`)는 서버가 classicube.net에서 받아 캐시합니다. 마인크래프트 계정은 필요 없고, 이름 인증은 하지 않습니다.

## 물풍선 대작전 (온라인 레트로 아레나)

16×16 픽셀 타일로 그린 레트로 물풍선 대전입니다. 물풍선으로 상자를 터뜨려 아이템(풍선 수·물줄기·속도)을 모으고, 물줄기에 갇힌 상대는 몸으로 부딪혀 터뜨립니다. 마지막 1분은 바깥부터 벽이 닫혀 들어와 판이 반드시 끝납니다.

- 혼자 하기: 컴퓨터 1~3명, 난이도 3단계, 맵 2개
- 온라인 대전: 방을 만들고 6자리 코드나 초대 링크(`/apps/balloon/?room=코드`)를 보내면 최대 4명이 함께 합니다. 빈자리는 컴퓨터로 채울 수 있고, 다섯 번째부터는 관전합니다.

규칙(`public/apps/balloon/rules.js`)과 컴퓨터 플레이어(`ai.js`)는 브라우저와 서버가 같은 파일을 씁니다. 온라인에서는 서버(`balloon-online.mjs`)가 초당 20틱으로 판을 돌리고, 플레이어는 키 입력만 보내며, 결과 화면을 Server-Sent Events로 받습니다. 그래서 클라이언트를 조작해도 판정을 바꿀 수 없습니다. 연결이 끊기거나 나간 플레이어는 그 판이 끝날 때까지 컴퓨터가 대신 조종합니다. 키 입력은 일반 요청 제한 대신 자리당 초당 40회로 제한합니다. 방은 서버 메모리에만 있습니다.

## 크롬 앱과 프록시

외부 사이트는 서버가 대신 받아 링크를 `/proxy?url=...`로 바꿔서 보여줍니다. 공개 서버라서 다음 제한이 있습니다.

- http/https만 허용, 내부망·루프백 주소 차단(접속 시점 DNS 검사로 리바인딩 방지)
- IP당 분당 240요청, 응답 8MB, 15초 제한, 쿠키 미전달, GET만 지원
- 프록시된 페이지는 샌드박스(별도 출처)에서 실행되어 이 사이트의 저장소에 접근할 수 없습니다

그래서 로그인, 동영상 재생, 스크립트로 주소를 만드는 복잡한 사이트는 제대로 동작하지 않을 수 있습니다. 크롬 앱 오른쪽 위 버튼으로 실제 브라우저에서 열 수 있습니다.

## 고스톱 연동

고스톱은 `gostop-next`(화투클럽)를 iframe으로 띄웁니다. 주소는 환경 변수 `GOSTOP_URL`(기본값 `http://localhost:3000`)로 정합니다. 사이트를 https로 배포하면 화투클럽도 https 주소여야 합니다.

연결이 안 될 때는 서버가 `/api/gostop/status`로 원인을 직접 확인해서 앱 화면에 알려 줍니다: 주소 미설정, 서버가 잠듦(Render 무료 서버 — 최대 2분 동안 자동으로 다시 확인), 연결 불가, iframe 금지 헤더(X-Frame-Options/CSP), https 페이지의 http 주소. 화투클럽도 잠들지 않게 하려면 GitHub 저장소 변수 `GOSTOP_URL`을 정하세요(keep-warm 워크플로가 함께 깨웁니다).

## Render 배포

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Render에서 Blueprint로 `render.yaml`을 불러옵니다.
3. `GOSTOP_URL`에 배포된 화투클럽 주소를 넣습니다 (예: `https://hwatu-club.onrender.com`).

현재 배포: https://win11-web-64by.onrender.com/ — Render가 GitHub와 연결되어 `main`에 푸시하면 자동 배포됩니다. `/healthz`는 배포된 커밋을 알려줍니다.
