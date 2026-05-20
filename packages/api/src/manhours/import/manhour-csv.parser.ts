import { BadRequestException } from '@nestjs/common';
import { decodeShiftJis } from './sjis.util';

// ---------------------------------------------------------------------------
// 稼働管理表（明細）CSV パーサ
//
// 列: 組織コード,組織名称,担当者,作業区分,顧客名,件名,プロジェクトCD,
//     SE/NE担当部署,受注ランク,4月,5月,...,3月  (会計年度 4月→翌3月)
//
// 行区分(作業区分):
//   AFT/MNT/SY/空  → 案件工数 (entry)
//   zz             → 非稼働(休暇/会議/事務) entry, project なし
//   合計 ＋ 件名"月基準時間" → 担当者の月キャパ (capacity)
//   合計 (それ以外: 非稼働合計/月合計/稼働率…) → 破棄
//
// 同一 担当者×CD×作業区分 が期間別に複数行へ分割されるため
// (担当者,CD,作業区分,年月) で合算する。
// ---------------------------------------------------------------------------

export interface ParsedManhourEntry {
  assigneeName: string;
  /** プロジェクトCD。空 / "-" は null（件名で仮案件を作る）。 */
  projectCode: string | null;
  /** 件名（CD ごと最初の非空。仮案件名・突合表示に使う）。 */
  projectName: string;
  customerName: string | null;
  /** 'AFT' | 'MNT' | 'SY' | '' | 'zz' */
  workType: string;
  yearMonth: string; // 'YYYY-MM'
  hours: number;
  /** 案件の同一性キー: CD があれば `cd:<CD>`、無ければ `nm:<件名>`。 */
  projectKey: string;
  /** 件名（project 化しない明細＝CD無し/zz の内訳ラベル用）。 */
  label: string;
  /** CSV顧客名(E列) の生値。明細に顧客マスタ非依存で出すため保持。 */
  customerLabel: string | null;
}

export interface ParsedCapacity {
  assigneeName: string;
  yearMonth: string;
  baseHours: number;
}

export interface ParsedProjectIdentity {
  projectKey: string;
  projectCode: string | null;
  sampleName: string;
  customerName: string | null;
  /** 件名から期間/工程表記を除いた「束ね名」。複数CD(工程別)を 1
   *  プロジェクトに自動グルーピング提案するためのキー。 */
  stem: string;
}

/**
 * 件名 → 束ね名(stem)。期間表記「(4月)」「(4,5月)」「(4?6月)」「(7〜9月)」や
 * 工程表記「（SS-ST工程）」「（UI工程）」等を取り除き、区切りを正規化。
 * 工程ごとに別CDでも同じ案件は同じ stem になる（あくまで提案。画面で編集可）。
 */
export function projectStemLabel(subject: string): string {
  const s = (subject || '')
    .normalize('NFKC')
    // 期間表記: 括弧有無どちらも。例 (4月) (4,5月) (4?6月) (7-9月) 4月
    .replace(/[(（]?\s*\d{1,2}\s*[?\-,~〜・]?\s*\d{0,2}\s*月\s*[)）]?/g, ' ')
    // 工程表記の括弧: （…工程）
    .replace(/[(（][^(()）]*工程[)）]/g, ' ')
    // 区切り( _ ・ - 空白 )を畳む
    .replace(/[_\s・\-]+/g, ' ')
    .trim();
  return s || (subject || '').trim();
}

/** グルーピング用キー（大小無視）。表示名は projectStemLabel を使う。 */
export function projectStem(subject: string): string {
  return projectStemLabel(subject).toLowerCase();
}

export interface ParsedManhourCsv {
  orgCode: string | null;
  /** CSV B列「組織名称」の初回非空値（例: ＳＳ）ＳＳ統括）ＩＳ部）４シス）。 */
  orgName: string | null;
  assigneeNames: string[];
  /** 案件行に出た distinct な顧客名(E列)。出現順。zz は対象外。 */
  customerNames: string[];
  entries: ParsedManhourEntry[];
  capacities: ParsedCapacity[];
  projects: ParsedProjectIdentity[];
}

const HEADER = {
  orgCode: '組織コード',
  orgName: '組織名称',
  assignee: '担当者',
  workType: '作業区分',
  customer: '顧客名',
  subject: '件名',
  projectCode: 'プロジェクトCD',
} as const;

/**
 * RFC4180 風 CSV パーサ。クォート内のカンマ・改行・`""` エスケープに対応。
 * 戻り値は行×フィールドの二次元配列（完全空行は除外）。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    if (!row.every((f) => f === '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush trailing field/row (file without final newline).
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

function fiscalYearMonth(fiscalYear: number, month: number): string {
  // 4–12月 は当年、1–3月 は翌暦年 (会計年度 4月始まり)。
  const calYear = month >= 4 ? fiscalYear : fiscalYear + 1;
  return `${calYear}-${String(month).padStart(2, '0')}`;
}

function cleanCell(v: string | undefined): string {
  return (v ?? '').trim();
}

function parseHours(raw: string): number | null {
  const s = raw.trim();
  if (s === '' || s === '-') return null;
  // Defensive: drop thousands separators / stray %; the 稼働率 row is already
  // excluded upstream so % should never reach here.
  const num = Number(s.replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(num) ? num : null;
}

/**
 * 稼働管理表 CSV を会計年度 `fiscalYear` 基準で解析する。
 */
export function parseManhourCsv(
  buffer: Buffer,
  fiscalYear: number,
): ParsedManhourCsv {
  const text = decodeShiftJis(buffer);
  const grid = parseCsv(text);
  if (grid.length < 2) {
    throw new BadRequestException(
      'CSV にデータ行がありません。稼働管理表（明細）の出力ファイルか確認してください。',
    );
  }

  const header = grid[0].map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);

  const cOrg = col(HEADER.orgCode);
  const cOrgName = col(HEADER.orgName);
  const cAssignee = col(HEADER.assignee);
  const cWorkType = col(HEADER.workType);
  const cCustomer = col(HEADER.customer);
  const cSubject = col(HEADER.subject);
  const cCode = col(HEADER.projectCode);
  if (cAssignee < 0 || cWorkType < 0 || cSubject < 0) {
    throw new BadRequestException(
      '想定した列ヘッダ（担当者 / 作業区分 / 件名）が見つかりません。稼働管理表（明細）のCSVではない可能性があります。',
    );
  }

  // 月列: ヘッダが "N月" のものを月番号付きで収集。
  const monthCols: Array<{ month: number; idx: number }> = [];
  header.forEach((h, idx) => {
    const m = /^(\d{1,2})月$/.exec(h);
    if (m) monthCols.push({ month: Number(m[1]), idx });
  });
  if (monthCols.length === 0) {
    throw new BadRequestException('月列（4月〜3月）が見つかりません。');
  }

  let orgCode: string | null = null;
  let orgName: string | null = null;
  const assigneeNames: string[] = [];
  const seenAssignee = new Set<string>();
  const addAssignee = (name: string): void => {
    if (name && !seenAssignee.has(name)) {
      seenAssignee.add(name);
      assigneeNames.push(name);
    }
  };
  const customerNames: string[] = [];
  const seenCustomer = new Set<string>();
  const addCustomer = (name: string | null): void => {
    if (name && !seenCustomer.has(name)) {
      seenCustomer.add(name);
      customerNames.push(name);
    }
  };

  // 集約バッファ
  const entryMap = new Map<string, ParsedManhourEntry>();
  const capMap = new Map<string, ParsedCapacity>();
  const projMap = new Map<string, ParsedProjectIdentity>();

  for (let r = 1; r < grid.length; r += 1) {
    const cells = grid[r];
    if (cOrg >= 0 && orgCode === null) {
      const o = cleanCell(cells[cOrg]);
      if (o) orgCode = o;
    }
    if (cOrgName >= 0 && orgName === null) {
      const o = cleanCell(cells[cOrgName]);
      if (o) orgName = o;
    }
    const assignee = cleanCell(cells[cAssignee]);
    const workTypeRaw = cleanCell(cells[cWorkType]);
    const subject = cleanCell(cells[cSubject]);
    const customer = cCustomer >= 0 ? cleanCell(cells[cCustomer]) || null : null;
    const cdRaw = cCode >= 0 ? cleanCell(cells[cCode]) : '';
    const projectCode = cdRaw === '' || cdRaw === '-' ? null : cdRaw;

    if (!assignee) continue;

    // --- 合計 行: 月基準時間 のみ capacity 化、他は破棄 ---
    if (workTypeRaw === '合計') {
      if (subject.includes('月基準時間')) {
        addAssignee(assignee);
        for (const mc of monthCols) {
          const hrs = parseHours(cells[mc.idx] ?? '');
          if (hrs === null) continue;
          const ym = fiscalYearMonth(fiscalYear, mc.month);
          const key = `${assignee} ${ym}`;
          const prev = capMap.get(key);
          if (prev) prev.baseHours += hrs;
          else capMap.set(key, { assigneeName: assignee, yearMonth: ym, baseHours: hrs });
        }
      }
      continue;
    }

    // --- 明細 / zz ---
    const isZz = workTypeRaw === 'zz';
    const workType = isZz ? 'zz' : workTypeRaw; // '' / AFT / MNT / SY
    const projectKey = isZz
      ? `zz:${assignee}`
      : projectCode
        ? `cd:${projectCode}`
        : `nm:${subject || '(名称未設定)'}`;

    let hadValue = false;
    for (const mc of monthCols) {
      const hrs = parseHours(cells[mc.idx] ?? '');
      if (hrs === null) continue;
      hadValue = true;
      const ym = fiscalYearMonth(fiscalYear, mc.month);
      const key = `${assignee} ${projectKey} ${workType} ${ym}`;
      const prev = entryMap.get(key);
      if (prev) {
        prev.hours += hrs;
      } else {
        entryMap.set(key, {
          assigneeName: assignee,
          projectCode: isZz ? null : projectCode,
          projectName: subject || '(名称未設定)',
          customerName: customer,
          workType,
          yearMonth: ym,
          hours: hrs,
          projectKey,
          label: subject || (isZz ? '非稼働' : '(名称未設定)'),
          customerLabel: customer,
        });
      }
    }

    if (hadValue) addAssignee(assignee);

    // プロジェクト作成対象は「作業区分=AFT または SY」かつ「プロジェクトCD有り」
    // の行のみ。CD無しの AFT/SY や MNT/空/zz は工数のみ計上（件名ラベル）で
    // プロジェクト化しない。
    const isProjectTarget =
      (workType === 'AFT' || workType === 'SY') && projectCode !== null;
    if (isProjectTarget && (hadValue || subject)) {
      addCustomer(customer);
      const existing = projMap.get(projectKey);
      if (!existing) {
        projMap.set(projectKey, {
          projectKey,
          projectCode,
          sampleName: subject || '(名称未設定)',
          customerName: customer,
          stem: '',
        });
      } else if (!existing.sampleName && subject) {
        existing.sampleName = subject;
      }
    }
  }

  const projectList = Array.from(projMap.values()).map((p) => ({
    ...p,
    stem: projectStem(p.sampleName),
  }));

  return {
    orgCode,
    orgName,
    assigneeNames,
    customerNames,
    entries: Array.from(entryMap.values()),
    capacities: Array.from(capMap.values()),
    projects: projectList,
  };
}
