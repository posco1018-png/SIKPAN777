// 오늘 뭐 싸가? — Netlify Function 버전 API
// /api/schools, /api/meal, /api/recommend 를 한 함수에서 처리합니다.
// 추천은 AI 없이, 메뉴 이름에 맞춰 "맛을 돋우는 소스·곁들임"을 골라줍니다.

const NEIS = "https://open.neis.go.kr/hub";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function neis(endpoint, params) {
  const qs = new URLSearchParams({ Type: "json", pIndex: "1", pSize: "20", ...params });
  const key = process.env.NEIS_KEY;
  if (key) qs.set("KEY", key);
  const r = await fetch(`${NEIS}/${endpoint}?${qs}`);
  if (!r.ok) throw new Error(`NEIS ${r.status}`);
  const data = await r.json();
  if (data.RESULT) {
    if (data.RESULT.CODE === "INFO-200") return []; // 데이터 없음
    throw new Error(data.RESULT.MESSAGE || "NEIS 오류");
  }
  const block = data[endpoint];
  return block && block[1] ? block[1].row : [];
}

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

// ---------- 맛 돋우는 추천 규칙 ----------
// re: 메뉴에서 찾을 단어, tip: 한 줄 팁
// items: 추천 목록 (name, why = 어떤 맛을 살려주는지, skip = 이미 급식에 있으면 뺄 단어)
// 위에 있는 규칙이 우선입니다. 첫 규칙에서 4개까지, 나머지 규칙에서는 1개씩 채웁니다.
const RULES = [
  {
    re: /삼겹|보쌈|수육|목살|항정|족발/,
    tip: "고기는 쌈으로, 마늘과 파채로 느끼함을 잡으면 두 배로 맛있어요.",
    items: [
      { name: "쌈장", why: "고소하고 짭짤한 맛이 고기와 찰떡이에요." },
      { name: "편마늘", why: "생마늘의 알싸함이 기름진 맛을 잡아줘요." },
      { name: "파채 + 새콤 파채소스", why: "새콤매콤한 파채가 느끼함을 싹 정리해줘요." },
      { name: "새우젓", why: "삼겹·보쌈에 감칠맛을 더하는 정석 조합이에요." },
      { name: "청양고추", why: "칼칼한 맛이 고기 맛을 또렷하게 해줘요." },
    ],
  },
  {
    re: /닭갈비|닭볶음|찜닭|떡볶이|쭈꾸미|주꾸미|오징어볶음|낙지|불닭|마라/,
    tip: "매운 메뉴는 부드럽게 감싸주는 것과 남은 양념까지 먹는 방법이 포인트예요.",
    items: [
      { name: "슬라이스 치즈", why: "매운맛을 부드럽게 눌러주고 고소함을 더해요." },
      { name: "김가루", why: "남은 양념에 밥을 비벼 먹으면 마지막 한 입까지 맛있어요." },
      { name: "상추·깻잎", why: "매콤한 볶음을 쌈으로 싸 먹으면 맛이 한결 깔끔해요." },
      { name: "계란 프라이", why: "노른자가 매운 양념을 순하게 만들어줘요." },
    ],
  },
  {
    re: /불고기|제육|갈비|바비큐|bbq/i,
    tip: "달콤짭짤한 고기는 아삭한 쌈과 알싸한 맛을 곁들이면 더 맛있어요.",
    items: [
      { name: "상추·깻잎", why: "쌈으로 먹으면 달짝지근한 양념이 가벼워져요." },
      { name: "쌈마늘", why: "알싸한 맛이 고기 풍미를 끌어올려요.", skip: /마늘/ },
      { name: "쌈장", why: "된장의 구수함이 단맛과 균형을 맞춰줘요." },
      { name: "청양고추", why: "칼칼한 포인트가 느끼함을 잡아줘요." },
    ],
  },
  {
    re: /함박|스테이크|햄버그|미트볼|떡갈비/,
    tip: "소스 맛이 진한 고기에는 톡 쏘는 맛으로 입을 개운하게 해주세요.",
    items: [
      { name: "홀그레인 머스터드", why: "톡 쏘는 새콤함이 고기 맛을 선명하게 해줘요." },
      { name: "와사비", why: "아주 조금만 올려도 고기가 훨씬 깔끔해져요." },
      { name: "피클", why: "새콤한 맛이 느끼함을 정리해줘요.", skip: /피클/ },
    ],
  },
  {
    re: /돈까스|돈가스|카츠|커틀릿|가츠|까스|생선까스/,
    tip: "바삭한 튀김은 톡 쏘는 맛과 새콤한 맛이 잘 어울려요.",
    items: [
      { name: "홀그레인 머스터드", why: "소스와 같이 찍으면 고소한 튀김옷이 더 살아나요." },
      { name: "양배추 채 + 레몬즙", why: "상큼하게 입안을 정리해줘서 끝까지 맛있어요." },
      { name: "피클·할라피뇨", why: "새콤하고 칼칼한 맛이 느끼함을 잡아줘요.", skip: /피클/ },
      { name: "소금 · 후추", why: "소스 없이 먹을 때 튀김의 고소함이 더 느껴져요." },
    ],
  },
  {
    re: /치킨|닭강정|너겟|탕수|튀김|가라아게|핫도그|새우튀김|고로케|팝콘/,
    tip: "튀김에는 새콤하거나 매콤한 소스 하나만 더해도 훨씬 맛있어요.",
    items: [
      { name: "치킨무", why: "새콤달콤한 맛이 기름기를 싹 잡아줘요.", skip: /무$|무생채|단무지/ },
      { name: "핫소스·스리라차", why: "매콤한 한 방으로 맛에 포인트를 줘요." },
      { name: "허니머스터드", why: "달콤하고 톡 쏘는 맛이 튀김과 잘 어울려요." },
      { name: "소금 · 후추", why: "고소한 튀김옷의 맛이 더 또렷해져요." },
    ],
  },
  {
    re: /카레/,
    tip: "카레는 새콤하고 아삭한 곁들임이 있으면 맛이 한결 깔끔해요.",
    items: [
      { name: "락교·단무지", why: "새콤하고 아삭한 맛이 카레의 진한 맛을 정리해줘요.", skip: /단무지|락교/ },
      { name: "반숙 계란 프라이", why: "노른자가 소스와 섞여 훨씬 부드러워져요." },
      { name: "슬라이스 치즈", why: "밥 위에 올려 비비면 고소함이 더해져요." },
      { name: "김치", why: "카레와 의외로 잘 어울리는 매콤새콤 조합이에요.", skip: /김치|깍두기|겉절이/ },
      { name: "피클·할라피뇨", why: "새콤매콤한 맛이 카레의 진한 맛을 잡아줘요.", skip: /피클/ },
    ],
  },
  {
    re: /짜장|짬뽕밥|볶음짬뽕/,
    tip: "짜장에는 날카로운 맛으로 느끼함을 잡아줘요.",
    items: [
      { name: "단무지", why: "새콤달콤한 아삭함이 짜장의 기름기를 잡아줘요.", skip: /단무지/ },
      { name: "생양파 + 춘장 약간", why: "중국집 느낌이 나고 아삭한 단맛이 더해져요." },
      { name: "반숙 계란 프라이", why: "노른자가 짜장과 섞이면 고소함이 배가 돼요." },
    ],
  },
  {
    re: /국수|우동|칼국수|라면|쫄면|냉면|소바|잔치|짬뽕|수제비|쌀국수|면$/,
    tip: "면 요리는 매콤한 양념이나 아삭한 김치를 곁들이면 맛이 확 살아요.",
    items: [
      { name: "다진 청양고추", why: "국물에 넣으면 칼칼하고 시원해져요." },
      { name: "다진 양념(다대기)", why: "깊은 맛이 부족할 때 한 숟갈이면 충분해요." },
      { name: "김치(겉절이)", why: "새콤한 맛이 면과 정말 잘 어울려요.", skip: /김치|깍두기|겉절이/ },
      { name: "김가루·깨", why: "고소한 향이 올라와요." },
    ],
  },
  {
    re: /스파게티|파스타|리조또|그라탱|피자|라자냐|토마토/,
    tip: "치즈와 매콤한 소스를 곁들이면 이탈리안 맛이 더 살아나요.",
    items: [
      { name: "파마산 치즈 가루", why: "고소하고 짭짤한 풍미가 더해져요." },
      { name: "핫소스(타바스코)", why: "새콤하고 매콤한 맛이 토마토소스와 잘 어울려요." },
      { name: "피클·할라피뇨", why: "느끼함을 잡아줘요.", skip: /피클/ },
    ],
  },
  {
    re: /만두|교자|딤섬|꿔바로우|군만두/,
    tip: "만두는 소스 맛이 반이에요. 새콤하거나 매콤한 소스를 곁들여 보세요.",
    items: [
      { name: "초간장", why: "새콤하고 짭짤해서 만두 속 맛이 또렷해져요." },
      { name: "고추기름(라유)", why: "매콤한 향으로 풍미를 확 올려줘요." },
      { name: "연겨자", why: "코끝이 찡한 맛이 기름기를 잡아줘요." },
    ],
  },
  {
    re: /전$|부침|동그랑땡|전류|해물파전|부추전|김치전|감자전|호박전|산적|튀김$/,
    tip: "부침개는 새콤한 간장이 있으면 맛이 훨씬 좋아져요.",
    items: [
      { name: "초간장(간장+식초+고춧가루)", why: "새콤하게 기름맛을 잡아줘요." },
      { name: "양파절임", why: "아삭하고 새콤해서 전과 잘 어울려요." },
      { name: "청양고추", why: "칼칼하게 포인트를 줘요." },
    ],
  },
  {
    re: /볶음밥|비빔밥|덮밥|주먹밥|김밥|유부초밥|오므라이스/,
    tip: "밥 메뉴에는 고소한 참기름과 달걀 하나면 맛이 달라져요.",
    items: [
      { name: "계란 프라이", why: "반숙 노른자가 밥을 부드럽게 비벼줘요." },
      { name: "참기름 + 고추장", why: "한 숟갈만 넣어도 고소하고 칼칼해져요." },
      { name: "김가루", why: "고소한 향이 올라와요." },
      { name: "단무지·장아찌", why: "아삭한 식감과 새콤함을 더해요.", skip: /단무지|장아찌/ },
    ],
  },
  {
    re: /고등어|갈치|조기|삼치|꽁치|가자미|동태|생선|임연수|연어|참치|오징어채/,
    tip: "생선에는 비린 맛을 잡는 레몬이나 양념장을 곁들이면 좋아요.",
    items: [
      { name: "레몬 한 조각", why: "즙을 뿌리면 비린 맛이 사라지고 상큼해져요." },
      { name: "양념간장(청양고추+간장)", why: "밥이랑 같이 먹으면 입맛이 살아나요." },
      { name: "깻잎장아찌", why: "향긋하게 생선 맛을 정리해줘요." },
    ],
  },
  {
    re: /샐러드|사라다|과일/,
    tip: "샐러드는 소스가 좌우해요. 좋아하는 드레싱을 챙기면 맛이 달라져요.",
    items: [
      { name: "발사믹·오리엔탈 드레싱", why: "새콤달콤하게 채소 맛을 살려줘요." },
      { name: "구운 견과류", why: "고소한 식감이 더해져요." },
    ],
  },
  {
    re: /소시지|소세지|햄|스팸|비엔나|너비아니/,
    tip: "짭짤한 가공육에는 톡 쏘거나 새콤한 맛이 어울려요.",
    items: [
      { name: "머스터드", why: "톡 쏘는 맛이 짭짤한 맛을 정리해줘요." },
      { name: "매콤 케첩(핫소스)", why: "달콤매콤한 맛이 밥반찬으로 좋아요." },
      { name: "구운 김", why: "밥과 같이 싸 먹으면 간이 딱 맞아요." },
    ],
  },
  {
    re: /순두부|미역국|된장|북어|콩나물국|육개장|김치찌개|부대찌개|어묵탕|감자탕|국$|탕$|찌개/,
    tip: "국은 칼칼한 맛이나 향 하나만 더해도 한결 맛있어져요.",
    items: [
      { name: "다진 청양고추", why: "넣으면 국물이 칼칼하고 시원해져요." },
      { name: "후춧가루", why: "국물 맛이 깔끔하게 정리돼요." },
      { name: "김자반", why: "밥에 올려 먹으면 고소하고 짭짤해요." },
    ],
  },
];

const DEFAULT = {
  tip: "급식에 한 가지만 더해도 입맛이 확 달라져요. 칼칼한 맛이나 고소한 맛을 챙겨보세요.",
  items: [
    { name: "구운 김", why: "밥을 싸 먹으면 고소하고 간이 딱 맞아요." },
    { name: "청양고추", why: "칼칼한 포인트가 입맛을 살려줘요." },
    { name: "참기름 + 깨소금", why: "밥에 조금만 더하면 고소한 향이 올라와요." },
  ],
};

// "다진 청양고추", "파채 + 새콤 파채소스" 같은 이름을 짧게 정리 (헤드라인·중복 판정용)
const shortName = (n) => n.replace(/\(.*?\)/g, "").split(" + ")[0].trim();
const coreName = (n) => shortName(n).replace(/^다진 /, "");

function recommend(menu) {
  const text = menu.join(" ");
  const matched = RULES.filter((r) => menu.some((m) => r.re.test(m))); // 반찬 하나씩 검사
  const rules = matched.length ? matched : [DEFAULT];
  const items = [];
  const seen = new Set();
  rules.forEach((rule, idx) => {
    const quota = idx === 0 ? 4 : 1;
    let taken = 0;
    for (const it of rule.items) {
      if (taken >= quota || items.length >= 5) break;
      if (it.skip && it.skip.test(text)) continue; // 이미 급식에 나온 건 제외
      const core = coreName(it.name);
      if (seen.has(core)) continue; // 비슷한 건 한 번만
      seen.add(core);
      items.push({ name: it.name, why: it.why });
      taken++;
    }
  });
  return {
    source: "rule",
    headline: items.slice(0, 2).map((i) => shortName(i.name)).join(" · ") + " 챙겨가세요",
    items,
    tip: rules[0].tip,
  };
}

// ---------- 핸들러 ----------
export default async (req) => {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/api/schools" && req.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 2) return json({ error: "학교 이름을 두 글자 이상 입력해 주세요." }, 400);
      const rows = await neis("schoolInfo", { SCHUL_NM: q, SCHUL_KND_SC_NM: "초등학교" });
      return json({
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
      if (!office || !code || !/^\d{8}$/.test(date || "")) return json({ error: "요청이 올바르지 않아요." }, 400);
      const rows = await neis("mealServiceDietInfo", { ATPT_OFCDC_SC_CODE: office, SD_SCHUL_CODE: code, MLSV_YMD: date });
      const lunch = rows.find((r) => r.MMEAL_SC_NM === "중식") || rows[0];
      if (!lunch) return json({ meal: null });
      return json({
        meal: { type: lunch.MMEAL_SC_NM, date: lunch.MLSV_YMD, menu: parseMenu(lunch.DDISH_NM), kcal: lunch.CAL_INFO || "" },
      });
    }

    if (url.pathname === "/api/recommend" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const menu = Array.isArray(body.menu) ? body.menu.map(String).slice(0, 20) : [];
      if (!menu.length) return json({ error: "메뉴가 비어 있어요." }, 400);
      return json(recommend(menu));
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "급식 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." }, 502);
  }
};

// /api/* 요청을 이 함수로 보냅니다 (netlify.toml 의 리다이렉트 설정이 따로 필요 없어요)
export const config = { path: "/api/*" };
