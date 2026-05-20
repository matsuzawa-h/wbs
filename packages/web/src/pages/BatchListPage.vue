<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useManhoursStore } from '@/stores/manhours';
import { useOrganizationsStore } from '@/stores/organizations';
import { useEmployeesStore } from '@/stores/employees';
import { useCurrentUserStore } from '@/stores/currentUser';
import type { BatchCellDiff, BatchDiff, BatchStats, ManhourBatch } from '@/types';

const manhours = useManhoursStore();
const orgs = useOrganizationsStore();
const employees = useEmployeesStore();
const currentUser = useCurrentUserStore();

const fiscalYear = ref<number | 'all'>('all');
const orgFilter = ref<'all' | 'none' | number>('all');
const loading = ref(false);

// 展開中バッチ: id → { stats, diff }
const expanded = ref<Record<number, { stats: BatchStats | null; diff: BatchDiff | null; loading: boolean }>>({});
// 差分テーブル のフィルタ（バッチ毎）。
//   name    : 担当者名の部分一致（toLowerCase）
//   wt      : 区分セレクト ('all' | 'AFT' | 'MNT' | 'SY' | 'other' | '休暇' | '非稼働')
//   code    : プロジェクトCD の部分一致
//   subject : 件名/案件名 の部分一致
interface CellFilters {
  name: string;
  wt: 'all' | 'AFT' | 'MNT' | 'SY' | 'other' | '休暇' | '非稼働';
  code: string;
  subject: string;
}
const cellFilters = ref<Record<number, CellFilters>>({});
function emptyFilters(): CellFilters {
  return { name: '', wt: 'all', code: '', subject: '' };
}

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
const fyOptions = computed(() => {
  const b = currentFiscalYear();
  return [b + 1, b, b - 1, b - 2];
});

function orgIdParam(): number | null | undefined {
  if (orgFilter.value === 'all') return undefined;
  if (orgFilter.value === 'none') return null;
  return orgFilter.value;
}

async function reload(): Promise<void> {
  loading.value = true;
  try {
    const fy = fiscalYear.value === 'all' ? undefined : fiscalYear.value;
    await manhours.fetchBatches(fy, orgIdParam());
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([orgs.fetchAll(), employees.fetchAll()]);
  // 初期表示はログイン社員の所属組織で絞り込み（あれば）。無ければ「すべて」のまま。
  const myOrg = currentUser.current?.organizationId ?? null;
  if (
    orgFilter.value === 'all' &&
    myOrg !== null &&
    orgs.byCodeAsc.some((o) => o.id === myOrg)
  ) {
    orgFilter.value = myOrg;
  }
  await reload();
});

watch([fiscalYear, orgFilter], reload);

const visibleBatches = computed<ManhourBatch[]>(() => manhours.batches);

async function toggleExpand(b: ManhourBatch): Promise<void> {
  if (expanded.value[b.id]) {
    delete expanded.value[b.id];
    delete cellFilters.value[b.id];
    return;
  }
  expanded.value = {
    ...expanded.value,
    [b.id]: { stats: null, diff: null, loading: true },
  };
  cellFilters.value = { ...cellFilters.value, [b.id]: emptyFilters() };
  try {
    const [stats, diff] = await Promise.all([
      manhours.fetchBatchStats(b.id),
      manhours.fetchBatchDiff(b.id),
    ]);
    expanded.value = {
      ...expanded.value,
      [b.id]: { stats, diff, loading: false },
    };
  } catch {
    delete expanded.value[b.id];
    delete cellFilters.value[b.id];
  }
}

// 区分マッチ: 「AFT」「MNT」「SY」「その他=空文字 workType」「休暇」「非稼働」
function matchesWt(
  row: { workType: string; subject: string },
  wt: CellFilters['wt'],
): boolean {
  if (wt === 'all') return true;
  if (wt === '休暇') return row.workType === 'zz' && row.subject === '休暇';
  if (wt === '非稼働') return row.workType === 'zz' && row.subject === '非稼働';
  if (wt === 'other') return !['AFT', 'MNT', 'SY', 'zz'].includes(row.workType);
  return row.workType === wt;
}

function filteredCellDiffs(batchId: number): BatchCellDiff[] {
  const diff = expanded.value[batchId]?.diff;
  if (!diff) return [];
  const f = cellFilters.value[batchId] ?? emptyFilters();
  const name = f.name.trim().toLowerCase();
  const code = f.code.trim().toLowerCase();
  const subject = f.subject.trim().toLowerCase();
  return diff.cellDiffs.filter((c) => {
    if (name && !c.assigneeName.toLowerCase().includes(name)) return false;
    if (!matchesWt(c, f.wt)) return false;
    if (code && !(c.projectCode ?? '').toLowerCase().includes(code)) return false;
    if (subject && !c.subject.toLowerCase().includes(subject)) return false;
    return true;
  });
}

function clearFilters(batchId: number): void {
  cellFilters.value = { ...cellFilters.value, [batchId]: emptyFilters() };
}

async function onDelete(b: ManhourBatch): Promise<void> {
  // 削除前にこのバッチの stats を取得して影響を提示
  let stats: BatchStats | null = expanded.value[b.id]?.stats ?? null;
  if (!stats) {
    try {
      stats = await manhours.fetchBatchStats(b.id);
    } catch {
      stats = null;
    }
  }
  const impact = stats
    ? `明細 ${stats.entryCount} 件 / 月基準時間 ${stats.capacityCount} 件 / 合計工数 ${stats.totalHours.toFixed(1)}h`
    : 'このバッチの全データ';
  if (
    !confirm(
      `バッチ #${b.id} (${b.fileName}) を削除します。よろしいですか？\n` +
        `削除されるデータ: ${impact}\n` +
        `※ 担当者・顧客・プロジェクトのマスタは残ります（他バッチや手入力が参照する可能性のため）。`,
    )
  ) {
    return;
  }
  await manhours.deleteBatch(b.id);
  delete expanded.value[b.id];
}

function ymLabel(ym: string): string {
  const [, m] = ym.split('-');
  return `${Number(m)}月`;
}

function fmtTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString('ja-JP');
}

function fmtDelta(n: number): string {
  return (n > 0 ? '+' : '') + n.toFixed(1);
}

function deltaClass(n: number): string {
  if (n > 0) return 'd-plus';
  if (n < 0) return 'd-minus';
  return 'd-zero';
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>取込履歴 / バッチ管理</h1>
      <div class="actions">
        <label class="fld">
          <span>年度</span>
          <select v-model="fiscalYear">
            <option value="all">すべて</option>
            <option v-for="y in fyOptions" :key="y" :value="y">{{ y }} 年度</option>
          </select>
        </label>
        <label class="fld">
          <span>組織</span>
          <select v-model="orgFilter">
            <option value="all">すべて</option>
            <option value="none">未紐付</option>
            <option v-for="o in orgs.byCodeAsc" :key="o.id" :value="o.id">
              {{ orgs.pathOf(o.id) }}
            </option>
          </select>
        </label>
      </div>
    </header>

    <p v-if="loading" class="muted">読込中…</p>
    <p v-else-if="visibleBatches.length === 0" class="muted">
      条件に一致する取込バッチがありません。
    </p>

    <table v-else class="b-table">
      <thead>
        <tr>
          <th class="col-id">#</th>
          <th class="col-file">ファイル名</th>
          <th class="col-fy">年度</th>
          <th class="col-org">組織</th>
          <th class="col-time">取込日時</th>
          <th class="col-rows num">明細</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="b in visibleBatches" :key="b.id">
          <tr>
            <td class="col-id">{{ b.id }}</td>
            <td class="col-file" :title="b.fileName">{{ b.fileName }}</td>
            <td class="col-fy">{{ b.fiscalYear }}</td>
            <td class="col-org">
              <span v-if="b.organizationId !== null">{{ orgs.pathOf(b.organizationId) }}</span>
              <span v-else class="muted">— ({{ b.orgCode ?? '' }})</span>
            </td>
            <td class="col-time">{{ fmtTimestamp(b.importedAt) }}</td>
            <td class="col-rows num">{{ b.rowCount }}</td>
            <td class="col-actions">
              <button class="btn small" type="button" @click="toggleExpand(b)">
                {{ expanded[b.id] ? '閉じる' : '詳細／差分' }}
              </button>
              <button class="btn small danger" type="button" @click="onDelete(b)">削除</button>
            </td>
          </tr>
          <tr v-if="expanded[b.id]" class="ex-row">
            <td colspan="7">
              <div v-if="expanded[b.id]!.loading" class="muted">読込中…</div>
              <div v-else-if="expanded[b.id]!.stats" class="ex-body">
                <div class="ex-stats">
                  <div class="kpi">
                    <span class="kpi-label">担当者</span>
                    <span class="kpi-val">{{ expanded[b.id]!.stats!.assigneeCount }} 名</span>
                  </div>
                  <div class="kpi">
                    <span class="kpi-label">プロジェクト</span>
                    <span class="kpi-val">{{ expanded[b.id]!.stats!.projectCount }} 件</span>
                  </div>
                  <div class="kpi">
                    <span class="kpi-label">明細</span>
                    <span class="kpi-val">{{ expanded[b.id]!.stats!.entryCount }} 件</span>
                  </div>
                  <div class="kpi">
                    <span class="kpi-label">月基準時間</span>
                    <span class="kpi-val">{{ expanded[b.id]!.stats!.capacityCount }} 件</span>
                  </div>
                  <div class="kpi">
                    <span class="kpi-label">合計工数</span>
                    <span class="kpi-val">{{ expanded[b.id]!.stats!.totalHours.toFixed(1) }} h</span>
                  </div>
                </div>

                <div class="ex-monthly">
                  <strong>月別合計工数</strong>
                  <table class="mini">
                    <thead>
                      <tr>
                        <th
                          v-for="ym in Object.keys(expanded[b.id]!.stats!.monthlyTotals).sort()"
                          :key="ym"
                        >{{ ymLabel(ym) }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td
                          v-for="ym in Object.keys(expanded[b.id]!.stats!.monthlyTotals).sort()"
                          :key="ym"
                          class="num"
                        >{{ expanded[b.id]!.stats!.monthlyTotals[ym].toFixed(1) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="ex-diff">
                  <strong>
                    直前バッチとの差分
                    <span v-if="expanded[b.id]!.diff!.previousBatchId !== null" class="muted small">
                      (vs #{{ expanded[b.id]!.diff!.previousBatchId }})
                    </span>
                    <span v-else class="muted small">（同じ組織×年度で初回）</span>
                  </strong>
                  <div v-if="expanded[b.id]!.diff!.previousBatchId === null" class="muted small">
                    比較対象が無いため delta = current の値そのものです。
                  </div>
                  <div v-else class="diff-kpi">
                    <div class="kpi">
                      <span class="kpi-label">担当者</span>
                      <span class="kpi-val" :class="deltaClass(expanded[b.id]!.diff!.delta.assigneeCount)">
                        {{ fmtDelta(expanded[b.id]!.diff!.delta.assigneeCount) }}
                      </span>
                    </div>
                    <div class="kpi">
                      <span class="kpi-label">プロジェクト</span>
                      <span class="kpi-val" :class="deltaClass(expanded[b.id]!.diff!.delta.projectCount)">
                        {{ fmtDelta(expanded[b.id]!.diff!.delta.projectCount) }}
                      </span>
                    </div>
                    <div class="kpi">
                      <span class="kpi-label">明細</span>
                      <span class="kpi-val" :class="deltaClass(expanded[b.id]!.diff!.delta.entryCount)">
                        {{ fmtDelta(expanded[b.id]!.diff!.delta.entryCount) }}
                      </span>
                    </div>
                    <div class="kpi">
                      <span class="kpi-label">合計工数</span>
                      <span class="kpi-val" :class="deltaClass(expanded[b.id]!.diff!.delta.totalHours)">
                        {{ fmtDelta(expanded[b.id]!.diff!.delta.totalHours) }} h
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="expanded[b.id]!.diff!.previousBatchId !== null && Object.keys(expanded[b.id]!.diff!.delta.monthlyTotals).length > 0"
                    class="diff-months"
                  >
                    <strong class="small">月別差分（0 以外）</strong>
                    <table class="mini">
                      <thead>
                        <tr>
                          <th
                            v-for="ym in Object.keys(expanded[b.id]!.diff!.delta.monthlyTotals).sort()"
                            :key="ym"
                          >{{ ymLabel(ym) }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td
                            v-for="ym in Object.keys(expanded[b.id]!.diff!.delta.monthlyTotals).sort()"
                            :key="ym"
                            class="num"
                            :class="deltaClass(expanded[b.id]!.diff!.delta.monthlyTotals[ym])"
                          >
                            {{ fmtDelta(expanded[b.id]!.diff!.delta.monthlyTotals[ym]) }}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div
                    v-if="expanded[b.id]!.diff!.previousBatchId !== null"
                    class="diff-lists"
                  >
                    <div v-if="expanded[b.id]!.diff!.addedAssignees.length > 0" class="lst">
                      <strong class="d-plus small">+ 新規登場の担当者:</strong>
                      <span>{{ expanded[b.id]!.diff!.addedAssignees.map((a) => a.name).join('、') }}</span>
                    </div>
                    <div v-if="expanded[b.id]!.diff!.removedAssignees.length > 0" class="lst">
                      <strong class="d-minus small">− 消えた担当者:</strong>
                      <span>{{ expanded[b.id]!.diff!.removedAssignees.map((a) => a.name).join('、') }}</span>
                    </div>
                    <div v-if="expanded[b.id]!.diff!.addedProjects.length > 0" class="lst">
                      <strong class="d-plus small">+ 新規プロジェクト:</strong>
                      <span>{{ expanded[b.id]!.diff!.addedProjects.map((p) => p.name).join('、') }}</span>
                    </div>
                    <div v-if="expanded[b.id]!.diff!.removedProjects.length > 0" class="lst">
                      <strong class="d-minus small">− 消えたプロジェクト:</strong>
                      <span>{{ expanded[b.id]!.diff!.removedProjects.map((p) => p.name).join('、') }}</span>
                    </div>
                  </div>

                  <div
                    v-if="expanded[b.id]!.diff!.cellDiffs.length > 0"
                    class="cell-diffs"
                  >
                    <strong class="small">
                      担当者×プロジェクト×月 別差分（前回→今回。delta=0 セルは空欄）
                    </strong>
                    <div class="cdt-filter">
                      <input
                        v-model="cellFilters[b.id]!.name"
                        type="search"
                        placeholder="担当者で絞込み"
                        class="ft-input ft-name"
                      />
                      <select v-model="cellFilters[b.id]!.wt" class="ft-input ft-wt">
                        <option value="all">区分: すべて</option>
                        <option value="AFT">AFT</option>
                        <option value="MNT">MNT</option>
                        <option value="SY">SY</option>
                        <option value="other">その他</option>
                        <option value="非稼働">非稼働</option>
                        <option value="休暇">休暇</option>
                      </select>
                      <input
                        v-model="cellFilters[b.id]!.code"
                        type="search"
                        placeholder="CD で絞込み"
                        class="ft-input ft-code"
                      />
                      <input
                        v-model="cellFilters[b.id]!.subject"
                        type="search"
                        placeholder="案件 / 件名で絞込み"
                        class="ft-input ft-subj"
                      />
                      <button
                        type="button"
                        class="btn small"
                        @click="clearFilters(b.id)"
                      >クリア</button>
                      <span class="muted small">
                        {{ filteredCellDiffs(b.id).length }} / {{ expanded[b.id]!.diff!.cellDiffs.length }} 件
                      </span>
                    </div>
                    <div class="cdt-scroll">
                      <table class="mini cdt">
                        <thead>
                          <tr>
                            <th class="cdt-name">担当者</th>
                            <th class="cdt-wt">区分</th>
                            <th class="cdt-cust">CD</th>
                            <th class="cdt-subj">案件 / 件名</th>
                            <th
                              v-for="ym in expanded[b.id]!.diff!.months"
                              :key="ym"
                              class="num cdt-mon"
                            >{{ ymLabel(ym) }}</th>
                            <th class="num cdt-tot">合計</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-if="filteredCellDiffs(b.id).length === 0">
                            <td :colspan="5 + expanded[b.id]!.diff!.months.length" class="muted">
                              条件に一致する差分行がありません。
                            </td>
                          </tr>
                          <tr
                            v-for="(c, i) in filteredCellDiffs(b.id)"
                            :key="i"
                          >
                            <td class="cdt-name">{{ c.assigneeName }}</td>
                            <td class="cdt-wt">
                              {{ c.workType === 'zz' ? c.subject : (c.workType || '—') }}
                            </td>
                            <td class="cdt-cust muted small">{{ c.projectCode ?? '—' }}</td>
                            <td class="cdt-subj" :title="`前回 ${c.hoursPrevious.toFixed(1)}h → 今回 ${c.hoursCurrent.toFixed(1)}h`">
                              {{ c.subject }}
                            </td>
                            <td
                              v-for="ym in expanded[b.id]!.diff!.months"
                              :key="ym"
                              class="num cdt-mon"
                              :class="deltaClass(c.monthlyDelta[ym] ?? 0)"
                            >{{ c.monthlyDelta[ym] ? fmtDelta(c.monthlyDelta[ym]) : '' }}</td>
                            <td class="num cdt-tot" :class="deltaClass(c.delta)">
                              {{ fmtDelta(c.delta) }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.page { max-width: 1280px; margin: 0 auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; gap: 1rem; flex-wrap: wrap; }
.page-header h1 { margin: 0; font-size: 1.2rem; }
.actions { display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; }
.fld { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: var(--c-text-muted); }
.fld select { padding: 0.3rem 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; font: inherit; }
.muted { color: #94a3b8; font-size: 0.88rem; }
.muted.small { font-size: 0.78rem; }

.b-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; font-size: 0.88rem; }
.b-table th, .b-table td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid #f1f5f9; }
.b-table th { background: #f8fafc; font-weight: 600; color: #475569; }
.col-id { width: 50px; font-family: 'Menlo', 'Consolas', monospace; font-size: 0.82rem; color: #4b5563; }
.col-file { font-weight: 500; }
.col-fy { width: 70px; }
.col-org { width: 240px; color: #475569; }
.col-time { width: 165px; white-space: nowrap; font-variant-numeric: tabular-nums; color: #475569; }
.col-rows { width: 80px; font-variant-numeric: tabular-nums; }
.col-actions { width: 200px; white-space: nowrap; }
.col-actions .btn + .btn { margin-left: 0.3rem; }
.num { text-align: right; }

.btn { border: 1px solid #d1d5db; background: #fff; border-radius: 4px; padding: 0.3rem 0.65rem; cursor: pointer; font-size: 0.83rem; }
.btn:hover { background: #f9fafb; }
.btn.small { padding: 0.2rem 0.5rem; font-size: 0.8rem; }
.btn.danger:hover { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }

.ex-row td { background: #f8fafc; padding: 0.6rem 0.8rem !important; }
.ex-body { display: flex; flex-direction: column; gap: 0.7rem; }
.ex-stats, .diff-kpi { display: flex; gap: 0.8rem; flex-wrap: wrap; }
.kpi { display: inline-flex; flex-direction: column; gap: 0.1rem; padding: 0.35rem 0.7rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; min-width: 88px; }
.kpi-label { font-size: 0.72rem; color: #6b7280; }
.kpi-val { font-weight: 600; font-variant-numeric: tabular-nums; }
.d-plus { color: #047857; }
.d-minus { color: #b91c1c; }
.d-zero { color: #6b7280; }

.mini { border-collapse: collapse; font-size: 0.82rem; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px; }
.mini th, .mini td { padding: 0.2rem 0.5rem; border-right: 1px solid #f1f5f9; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mini th { background: #f1f5f9; color: #475569; }

.diff-lists { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.4rem; font-size: 0.83rem; }
.lst { display: flex; gap: 0.4rem; align-items: baseline; }
.cell-diffs { margin-top: 0.5rem; }
.cdt-filter {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
  margin: 0.4rem 0;
}
.ft-input {
  padding: 0.25rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
  font-size: 0.82rem;
}
.ft-name { width: 9rem; }
.ft-wt { width: 9rem; }
.ft-code { width: 7rem; font-family: 'Menlo', 'Consolas', monospace; font-size: 0.78rem; }
.ft-subj { width: 14rem; }
.cdt-scroll { overflow-x: auto; max-width: 100%; }
.cdt {
  border-collapse: collapse;
  font-size: 0.78rem;
  table-layout: fixed;
}
.cdt th, .cdt td {
  padding: 0.15rem 0.35rem;
  border-right: 1px solid #f1f5f9;
  border-bottom: 1px solid #f1f5f9;
  white-space: nowrap;
}
.cdt th { background: #f1f5f9; color: #475569; font-weight: 600; position: sticky; top: 0; }
.cdt-name { width: 7rem; }
.cdt-wt { width: 4rem; }
.cdt-cust { width: 4.5rem; font-family: 'Menlo', 'Consolas', monospace; font-size: 0.74rem; color: #6b7280; }
.cdt-subj { width: 14rem; overflow: hidden; text-overflow: ellipsis; }
.cdt-mon { width: 3.3rem; font-variant-numeric: tabular-nums; }
.cdt-tot { width: 4rem; font-variant-numeric: tabular-nums; font-weight: 600; }
.cdt tbody tr:hover td { background: #fffbeb; }
</style>
