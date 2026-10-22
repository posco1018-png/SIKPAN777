# 오늘 뭐 싸가?

학교 이름을 입력하면 오늘 급식 메뉴를 불러오고, 집에서 뭘 싸가면 더 풍성하게 먹을 수 있는지 추천해주는 웹서비스입니다.
예: 삼겹살이 나오는 날 → 편마늘, 파채, 쌈장

## 실행

Node.js 18 이상이 필요합니다. 설치할 패키지는 없습니다.

```bash
node server.js
# http://localhost:3000
```

## 환경변수 (모두 선택)

| 이름 | 설명 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 있으면 Claude가 오늘 메뉴를 보고 추천합니다. 없으면 내장 규칙으로 추천합니다. |
| `ANTHROPIC_MODEL` | 사용할 모델 (기본값 `claude-sonnet-5-5`) |
| `NEIS_KEY` | NEIS 교육정보 개방 포털(open.neis.go.kr) 인증키. 없어도 되지만 조회 건수가 제한됩니다. |
| `PORT` | 서버 포트 (기본값 3000) |

## 구조

- `server.js`: 학교 검색(`/api/schools`), 급식 조회(`/api/meal`), 추천(`/api/recommend`)
- `public/index.html`: 화면 (학교는 브라우저에 저장되어 다음 접속 때 바로 열립니다)

## Netlify로 배포

이 폴더는 Netlify에 바로 올릴 수 있게 되어 있습니다. `netlify.toml`이 `public/`을 사이트로, `netlify/functions/api.mjs`를 `/api/*` 함수로 지정합니다.

1. 이 폴더를 GitHub 저장소로 올립니다.
2. Netlify에서 **Add new site → Import an existing project**로 그 저장소를 고릅니다. 빌드 명령은 비워 두면 됩니다.
3. **Site configuration → Environment variables**에 `ANTHROPIC_API_KEY`를 추가합니다(선택). 추가하면 다시 배포해야 반영됩니다.

GitHub 없이 올리려면 터미널에서 `npx netlify-cli deploy --prod`를 실행하면 됩니다. 로컬에서 Netlify와 똑같이 돌려보려면 `npx netlify-cli dev`를 쓰세요.

`server.js`는 Netlify 없이 내 컴퓨터나 일반 Node 서버에서 돌릴 때만 쓰는 파일입니다. Netlify에서는 사용되지 않아요.

API 키는 환경변수로만 설정하세요. 화면 코드에 넣으면 안 됩니다.
