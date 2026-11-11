// Locked acceptance tests: the approved copy of SPEC sections 6 and 10, and the tests' own wind-level table.
// Shared by the unit tests (vitest) and the UAT scripts (Playwright). Strings are copied from SPEC.md word for word;
// items that SPEC section 10 names only by id (B2, H1, F3, ...) are read from web/SOURCES.md, Vietnamese column.
import { readFileSync } from 'node:fs';

const SOURCES_MD = (() => {
  try {
    return readFileSync(new URL('../SOURCES.md', import.meta.url), 'utf8');
  } catch {
    return '';
  }
})();

/**
 * Vietnamese (UI) cell of the SOURCES.md table row with this id (case-sensitive: "B2" is not "b2"),
 * looked up only in the "### Verified" part of the section "## {section}" (for example "Safety" or "GK-2A"),
 * so a row with the same id under Rejected or Not found, or in another section, is never read.
 */
export function sourceVi(id, section) {
  const sec = SOURCES_MD.split(/^## /m).find((s) => s.startsWith(`${section}\n`));
  if (!sec) throw new Error(`SOURCES.md has no section "## ${section}"`);
  const verified = sec.split(/^### /m).find((s) => s.startsWith('Verified\n'));
  if (!verified) throw new Error(`SOURCES.md section "${section}" has no "### Verified" part`);
  const line = verified.split('\n').find((l) => l.startsWith(`| ${id} |`));
  if (!line) throw new Error(`SOURCES.md, ${section}, Verified has no row "${id}"`);
  return line.split(' | ')[1].trim();
}

// ---- SPEC 6.2 / 6.3 / 6.4 ----
export const CONE_LEGEND = 'Vòng tròn: tâm bão có khoảng 70% khả năng đi vào (bán kính trung bình năm 2023 của Cơ quan Khí tượng Nhật Bản)';
export const CONE = [
  { hours: 24, radiusKm: 86 },
  { hours: 48, radiusKm: 148 },
  { hours: 72, radiusKm: 217 },
];
export const SUMMARY_AT_NOW = 'Bão Yagi · đang ở biển Đông · sức gió cấp 17 (ước tính)';
export const headAffected = (place) => `Có. Gió từ cấp 8 trở lên sẽ tới ${place}`;
export const headUnaffected = (place) => `Không. ${place} nằm ngoài vùng gió từ cấp 8 trở lên`;
export const VERDICT_NOTE = 'Nơi này vẫn có thể có gió cấp 6–7 và mưa lớn.';
export const verdictWind = (n) => `Sức gió lớn nhất: cấp ${n} (ước tính)`;
export const CREDITS = [
  'Usui-chan, linh vật của CLB Thiên văn USAC',
  'Đường đi bão: IBTrACS v04r01 (NOAA)',
  'Đường bờ biển: Natural Earth',
  'Tọa độ tỉnh: © những người đóng góp OpenStreetMap',
];

// ---- SPEC 10.1 ----
export const CARD_WIND = {
  title: 'Cấp gió là gì?',
  body: [
    '"Cấp gió" là bậc đo sức gió theo thang Bô-pho. Sức gió mạnh nhất của bão là tốc độ gió trung bình lớn nhất đo trong 2 phút.',
    'Áp thấp nhiệt đới: gió mạnh nhất cấp 6–7. Bão: từ cấp 8. Bão mạnh: cấp 10–11. Bão rất mạnh: cấp 12–15. Siêu bão: từ cấp 16 trở lên.',
    'Cấp 6–7 (39–61 km/giờ): cây cối rung chuyển, khó đi ngược gió. Cấp 8–9 (62–88 km/giờ): gãy cành cây, tốc mái nhà. Cấp 10–11 (89–117 km/giờ): đổ cây, đổ nhà, đổ cột điện. Từ cấp 12 (118 km/giờ trở lên): sức phá hoại cực kỳ lớn.',
    'Cấp gió trên trang này là ước tính: số liệu gốc của Mỹ tính gió trung bình trong 1 phút, còn Việt Nam tính trong 2 phút, nên cấp thật có thể thấp hơn một chút.',
  ],
  source: 'Nguồn: Quyết định 18/2021/QĐ-TTg; bản tin bão của Trung tâm Dự báo khí tượng thủy văn quốc gia; IBTrACS (NOAA).',
};

// ---- SPEC 10.2 ----
export const CARD_RADIUS = {
  title: 'Vùng gió mạnh là gì?',
  body: [
    'Bản tin bão của Việt Nam gọi nơi có gió từ cấp 6 trở lên do bão gây ra là vùng gió mạnh.',
    'Trên bản đồ này, vùng tô màu quanh tâm bão là nơi có gió từ cấp 8 trở lên. Số liệu dùng ở đây không có vùng gió cấp 6, nên nơi ngoài vùng tô màu vẫn có thể có gió cấp 6–7.',
    'Các vòng tròn cho biết nơi tâm bão có khoảng 70% khả năng đi vào sau 24, 48 và 72 giờ. Bản tin bão của Việt Nam cũng vẽ vòng tròn 70% như vậy.',
  ],
  source: 'Nguồn: Quyết định 18/2021/QĐ-TTg; Cơ quan Khí tượng Nhật Bản, báo cáo năm 2023; IBTrACS (NOAA).',
};

// ---- SPEC 10.3 ----
export const ACTIONS = [
  'Cả nhà bàn trước chỗ trú ẩn an toàn nhất; khi chính quyền yêu cầu thì sơ tán ngay.',
  'Dự trữ đủ lương thực, nước uống, thuốc men và đồ dùng thiết yếu.',
  'Tuyệt đối không ra ngoài khi bão đang đổ bộ, trừ khi khẩn cấp và có hướng dẫn của chính quyền.',
];
export const ACTIONS_SOURCE = 'Nguồn: khuyến cáo của Cục Quản lý đê điều và Phòng, chống thiên tai (đăng trên Báo Luật sư Việt Nam); Cổng thông tin điện tử tỉnh Hà Tĩnh.';
const B1_CORRECTED = 'Theo dõi dự báo, cảnh báo và cập nhật diễn biến của bão để chủ động phòng tránh.';
const safe = (id, section = 'Safety') => {
  try {
    return sourceVi(id, section);
  } catch {
    return `<SOURCES.md row ${id} missing>`;
  }
};
/** The card's sections in order: heading, then its items (SPEC 10.3). */
export const CARD_SAFETY_SECTIONS = [
  { heading: 'Trước bão', items: [B1_CORRECTED, ...['B2', 'B3', 'B4', 'B5', 'B6', 'B8'].map((id) => safe(id, 'Safety'))] },
  { heading: 'Giữ nhà', items: ['H1', 'H2', 'H3', 'H4'].map((id) => safe(id, 'Safety')) },
  { heading: 'Khi bão đổ bộ', items: ['D1', 'D2'].map((id) => safe(id, 'Safety')) },
  { heading: 'Sau bão', items: ['A1', 'A2'].map((id) => safe(id, 'Safety')) },
];
export const CARD_SAFETY = {
  title: 'Làm gì khi bão tới?',
  body: CARD_SAFETY_SECTIONS.flatMap((s) => [s.heading, ...s.items]),
  source: ACTIONS_SOURCE,
};
export const CARDS_APPROVED = [CARD_WIND, CARD_RADIUS, CARD_SAFETY];

// ---- SPEC 10.4 ----
export const SAT_HEADING = 'Vệ tinh GK-2A';
export const SAT_FACTS = [
  'GK-2A là vệ tinh khí tượng của Hàn Quốc, phóng lên quỹ đạo vào tháng 12 năm 2018 và chính thức cung cấp dữ liệu từ ngày 25 tháng 7 năm 2019.',
  ...['F3', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11'].map((id) => safe(id, 'GK-2A')),
  'Hình vệ tinh trên màn hình chỉ là mô hình minh họa, không đúng tỉ lệ.',
];
export const SAT_SOURCE = 'Nguồn: Trung tâm Vệ tinh Khí tượng Quốc gia Hàn Quốc (NMSC), GK2A Fact Sheets; WMO OSCAR; Kim và cộng sự (2021), Remote Sensing.';

// ---- SPEC 10.5 ----
export const WHERE_TEMPLATE = 'Lúc {time}, tâm bão ở khoảng {lat}° Bắc, {lon}° Đông, sức gió cấp {n} (ước tính).';

/** Every fixed string SPEC section 10 (and the 6.2 legend, 6.4 credits) puts in vi.json word for word. */
export const APPROVED_FIXED = [
  CARD_WIND.title, ...CARD_WIND.body, CARD_WIND.source,
  CARD_RADIUS.title, ...CARD_RADIUS.body, CARD_RADIUS.source,
  CARD_SAFETY.title, ...CARD_SAFETY.body, CARD_SAFETY.source,
  ...ACTIONS,
  SAT_HEADING, ...SAT_FACTS, SAT_SOURCE,
  CONE_LEGEND,
  ...CREDITS,
];

// ---- SPEC 5.5: wind level from the Decision 18/2021 Appendix III table ----
export const KT_TO_MS = 0.514444;
/** Lower bound (m/s) of levels 0..17, from SOURCES.md "Beaufort table". */
export const BEAUFORT_LOWER_MS = [0, 0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7, 37.0, 41.5, 46.2, 51.0, 56.1];
/** The tests' own windLevel: level n covers [lower(n), lower(n+1)); above 61.2 m/s is 17; null gives null. */
export function refWindLevel(kt) {
  if (kt === null || kt === undefined) return null;
  const ms = kt * KT_TO_MS;
  let level = 0;
  for (let n = 0; n < BEAUFORT_LOWER_MS.length; n++) if (ms >= BEAUFORT_LOWER_MS[n]) level = n;
  return level;
}
/** SOURCES.md Beaufort table rows as [level, lower m/s], for the tests' self-check. */
export function sourcesBeaufortLower() {
  const sec = SOURCES_MD.split('### Beaufort table')[1]?.split('###')[0] ?? '';
  return [...sec.matchAll(/^\| (\d+) \| ([\d,]+)–/gm)].map((m) => [Number(m[1]), Number(m[2].replace(',', '.'))]);
}

/** A regex for a SPEC template: each {name} matches any {placeholder} the app chooses. */
export function templateRe(tpl) {
  const esc = tpl.split(/\{\w+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(esc.join('\\{\\w+\\}'));
}
