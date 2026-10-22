// 오늘 뭐 싸가? — 학교 급식에 곁들일 집 반찬을 추천하는 서버
// 의존성 없음 (Node 18 이상). 실행: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const NEIS_KEY = process.env.NEIS_KEY || ""; // 비어 있어도 동작 (조회 건수 제한)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ""; // 없으면 규칙 기반 추천 사용
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const PUBLIC_DIR = path.join(__dirname, "public");

const NEIS = "https://open.neis.go.kr/hub";

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function neis(endpoint, params) {
  const qs = new URLSearchParams({ Type: "json", pIndex: "1", pSize: "20", ...params });
  if (NEIS_KEY) qs.set("KEY", NEIS_KEY);
  const r = await fetch(`${NEIS}/${endpoint}?${qs}`);
  if (!r.ok) throw new Error(`NEIS ${r.status}`);
  const data = await r.json();
  if (data.RESULT) {
    // INFO-200: 데이터 없음
    if (data.RESULT.CODE === "INFO-200") return [];
    throw new Error(data.RESULT.MESSAGE || "NEIS 오류");
  }
  const block = data[endpoint];
  return block && block[1] ? block[1].row : [];
}

// 급식 메뉴 문자열 → 깔끔한 메뉴 배열
function parseMenu(raw) {
  return raw
    .split(/<br\s*\/?>/i)
    .map((s) =>
      s
        .replace(/\([\d.]+\)/g, "") // 알레르기 번호
        .replace(/\[[^\]]*\]/g, "") // [사과데이] 같은 꼬리표
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

// ---------- 규칙 기반 추천 (API 키가 없거나 AI 호출이 실패했을 때) ----------
const RULES = [
  { re: /삼겹|보쌈|수육|목살|항정/, tip: "고기는 쌈으로 먹어야 제맛이에요.", items: ["편마늘", "파채", "쌈장", "상추·깻잎"] },
  { re: /불고기|제육|bbq|바비큐|갈비|steak|스테이크/i, tip: "달콤짭짤한 고기에는 아삭한 채소가 잘 어울려요.", items: ["상추·깻잎", "쌈마늘", "고추 몇 개"] },
  { re: /돈까스|돈가스|치킨|탕수|너겟|커틀릿|튀김|가라아게|까스/, tip: "튀김에는 상큼하게 입을 개운하게 해줄 걸 곁들여요.", items: ["양배추 채", "피클", "방울토마토"] },
  { re: /카레|짜장|덮밥|오므라이스/, tip: "한 그릇 메뉴는 아삭한 반찬이 빠지기 쉬워요.", items: ["단무지·피클", "김치", "구운 김"] },
  { re: /국수|우동|라면|쫄면|파스타|스파게티|칼국수|짬뽕/, tip: "면 요리는 탄수화물이 많으니 단백질과 채소를 더해요.", items: ["삶은 달걀", "김치", "오이 · 당근 스틱"] },
  { re: /볶음밥|비빔밥|주먹밥|김밥|유부/, tip: "밥 메뉴에는 국물과 단백질을 보충해요.", items: ["김치", "구운 김", "계란말이"] },
  { re: /생선|고등어|갈치|조기|삼치|가자미|동태|꽁치/, tip: "생선에는 개운한 반찬이 어울려요.", items: ["김 · 김치", "레몬 한 조각", "깻잎장아찌"] },
  { re: /미역국|된장|순두부|북엇국|콩나물국|국$|탕$|찌개/, tip: "국이 있는 날은 밥반찬을 든든하게 해볼까요.", items: ["김자반", "멸치볶음", "젓갈 약간"] },
  { re: /샐러드|과일|사과|딸기|요거트|푸딩/, tip: "가벼운 날에는 든든하게 채워주세요.", items: ["삶은 달걀", "견과류", "치즈"] },
];
const DEFAULT = { tip: "급식에 곁들일 집 반찬 한 가지만 있어도 식사가 훨씬 풍성해져요.", items: ["김치", "구운 김", "삶은 달걀"] };

function ruleRecommend(menu) {
  const text = menu.join(" ");
  const hits = RULES.filter((r) => r.re.test(text));
  const picked = hits.length ? hits.slice(0, 2) : [DEFAULT];
  const seen = new Set();
  const items = [];
  for (const h of picked) for (const i of h.items) if (!seen.has(i)) { seen.add(i); items.push(i); }
  return {
    source: "rule",
    headline: items.slice(0, 2).join(" · ") + " 챙겨가세요",
    items: items.slice(0, 5).map((name) => ({ name, why: "" })),
    tip: picked[0].tip,
  };
}

// ---------- AI 추천 ----------
async function aiRecommend(menu) {
  const prompt =
    `초등학교 교사가 점심에 학교 급식을 먹습니다. 오늘 급식 메뉴는 다음과 같습니다:\n${menu.join(", ")}\n\n` +
    `집에서 간단히 싸가면 오늘 급식이 더 풍성하고 맛있어질 것 같은 것을 3~5가지 추천해 주세요. ` +
    `예: 삼겹살이 나오면 편마늘, 파채, 쌈장. 규칙: 가볍게 챙길 수 있는 것 위주(손질·조리가 거의 필요 없는 것), ` +
    `급식에 이미 있는 반찬과 겹치지 않게, 영양 균형도 고려하세요. ` +
    `각 항목에는 어떤 메뉴와 어울리는지 한 줄 이유를 붙이세요. ` +
    `반드시 다음 JSON만 출력하세요(코드블록 없이): ` +
    `{"headline":"한 줄 요약","items":[{"name":"추천 품목","why":"이유"}],"tip":"오늘 식단에 대한 한 줄 팁"}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const data = await r.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  if (!Array.isArray(json.items) || !json.items.length) throw new Error("empty");
  return {
    source: "ai",
    headline: String(json.headline || ""),
    items: json.items.slice(0, 6).map((i) => ({ name: String(i.name), why: String(i.why || "") })),
    tip: String(json.tip || ""),
  };
}

// ---------- 라우팅 ----------
async function readBody(req) {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 20000) throw new Error("too large"); }
  return s ? JSON.parse(s) : {};
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/schools" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return send(res, 400, { error: "학교 이름을 두 글자 이상 입력해 주세요." });
      const rows = await neis("schoolInfo", { SCHUL_NM: q, SCHUL_KND_SC_NM: "초등학교" });
      return send(res, 200, {
        schools: rows.map((r) => ({
          name: r.SCHUL_NM,
          office: r.ATPT_OFCDC_SC_CODE,
          officeName: r.ATPT_OFCDC_SC_NM,
          code: r.SD_SCHUL_CODE,
          address: r.ORG_RDNMA,
        })),
      });
    }

    if (url.pathname === "/api/meal" && req.method === "GET") {
      const office = url.searchParams.get("office");
      const code = url.searchParams.get("code");
      const date = url.searchParams.get("date");
      if (!office || !code || !/^\d{8}$/.test(date || "")) return send(res, 400, { error: "요청이 올바르지 않아요." });
      const rows = await neis("mealServiceDietInfo", {
        ATPT_OFCDC_SC_CODE: office,
        SD_SCHUL_CODE: code,
        MLSV_YMD: date,
      });
      const lunch = rows.find((r) => r.MMEAL_SC_NM === "중식") || rows[0];
      if (!lunch) return send(res, 200, { meal: null });
      return send(res, 200, {
        meal: {
          type: lunch.MMEAL_SC_NM,
          date: lunch.MLSV_YMD,
          menu: parseMenu(lunch.DDISH_NM),
          kcal: lunch.CAL_INFO || "",
        },
      });
    }

    if (url.pathname === "/api/recommend" && req.method === "POST") {
      const body = await readBody(req);
      const menu = Array.isArray(body.menu) ? body.menu.map(String).slice(0, 20) : [];
      if (!menu.length) return send(res, 400, { error: "메뉴가 비어 있어요." });
      if (ANTHROPIC_API_KEY) {
        try { return send(res, 200, await aiRecommend(menu)); } catch (e) { console.error("AI 추천 실패, 규칙 기반으로 대체:", e.message); }
      }
      return send(res, 200, ruleRecommend(menu));
    }

    // 정적 파일
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain");
    fs.readFile(full, (err, buf) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(buf);
    });
  } catch (e) {
    console.error(e);
    send(res, 502, { error: "급식 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." });
  }
});

server.listen(PORT, () => {
  console.log(`오늘 뭐 싸가? → http://localhost:${PORT}  (추천 방식: ${ANTHROPIC_API_KEY ? "AI" : "규칙 기반"})`);
});
