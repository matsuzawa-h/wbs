<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useManhoursStore } from '@/stores/manhours';
import { useOrganizationsStore } from '@/stores/organizations';
import ManhourImportDialog from '@/components/ManhourImportDialog.vue';
import ManualProjectDialog from '@/components/ManualProjectDialog.vue';
import ProjectDetailDialog from '@/components/ProjectDetailDialog.vue';
import type { Project, SummaryCell } from '@/types';

const manhours = useManhoursStore();
const orgs = useOrganizationsStore();

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
const fiscalYear = ref<number>(currentFiscalYear());
const importOpen = ref(false);
const manualProjectOpen = ref(false);
// 組織で絞込み（社員ベース）。'all' | 'none' | 組織ID
const orgFilter = ref<'all' | 'none' | number>('all');
// 展開中セル `${assigneeId}:${ym}`
const expanded = ref<string | null>(null);

const fyOptions = computed<number[]>(() => {
  const b = currentFiscalYear();
  return [b + 1, b, b - 1, b - 2];
});

function orgIdParam(): number | null | undefined {
  if (orgFilter.value === 'all') return undefined;
  if (orgFilter.value === 'none') return null;
  return orgFilter.value;
}

async function reload(): Promise<void> {
  await manhours.fetchBatches(fiscalYear.value, orgIdParam());
  await manhours.fetchSummary({
    fiscalYear: fiscalYear.value,
    batchId: manhours.selectedBatchId,
    organizationId: orgIdParam(),
  });
}

// 取込直後は新規組織が作られている可能性 + 新バッチを表示したい。
// 取込組織にフィルタを切替えて、新しいバッチが見える状態にする。
async function onImportCommitted(): Promise<void> {
  await orgs.fetchAll(true);
  // 直前の取込バッチが属する組織を特定して、フィルタを合わせる。
  await manhours.fetchBatches(fiscalYear.value);
  const latest = manhours.batches[0];
  if (latest) {
    manhours.selectedBatchId = null;
    const target =
      latest.organizationId === null ? 'none' : latest.organizationId;
    if (orgFilter.value !== target) {
      orgFilter.value = target; // watch が reload を呼ぶ
      return;
    }
  }
  await reload();
}

onMounted(async () => {
  await orgs.fetchAll();
  // CSV取込は組織ごとに行うので、初期表示は「先頭の組織」を選択した状態にする。
  // ユーザの操作で「すべて／未設定」へ切替可能。
  if (orgs.byCodeAsc.length > 0 && orgFilter.value === 'all') {
    orgFilter.value = orgs.byCodeAsc[0].id;
  }
  await reload();
});
watch(
  () => [
    fiscalYear.value,
    manhours.selectedBatchId,
    manhours.showImported,
    manhours.showProvisional,
  ],
  reload,
);
// 組織の切替は「その組織の最新バッチ」に追従させたいので selectedBatchId を
// クリアしてから reload する（取込履歴も組織別になる）。
watch(orgFilter, async () => {
  manhours.selectedBatchId = null;
  await reload();
});

function ymLabel(ym: string): string {
  const [, m] = ym.split('-');
  return `${Number(m)}月`;
}

function fmt(n: number): string {
  return n === 0 ? '' : n.toFixed(1);
}

// 36(残業) = total − base − 休暇 による 4 段階色分け。
//   ot < 0      → 余裕(青) 標準未達／余力あり
//   0..30       → 健全(緑)
//   31..59      → 注意(黄) 36協定 45h 接近
//   60..        → 警告(赤) 36協定上限接近
// base が無い／data が無いセルは無色（判定不可）。
function overtimeOf(cell: SummaryCell | undefined): number | null {
  if (!cell || cell.base === null) return null;
  return cell.total - cell.base - cell.vacation;
}
function utilClass(cell: SummaryCell | undefined): string {
  const ot = overtimeOf(cell);
  if (ot === null) return '';
  if (ot < 0) return 'u-under';
  if (ot <= 30) return 'u-ok';
  if (ot <= 59) return 'u-caution';
  return 'u-warn';
}

function cellOf(
  row: { cells: Record<string, SummaryCell> },
  ym: string,
): SummaryCell | undefined {
  return row.cells[ym];
}

function toggleExpand(assigneeId: number, ym: string): void {
  const k = `${assigneeId}:${ym}`;
  expanded.value = expanded.value === k ? null : k;
}

// 内訳グリッドの「仮(手入力)」行を直接編集（確定=取込分は編集不可）。
// hours<=0 で手入力は削除される（サービス側）。
async function onEditManual(
  assigneeId: number,
  ym: string,
  b: { projectId: number | null; workType: string },
  raw: string,
): Promise<void> {
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return;
  await manhours.saveManualEntry({
    assigneeId,
    projectId: b.projectId,
    workType: b.workType,
    yearMonth: ym,
    hours,
  });
  await reload();
}

// プロジェクト明細ポップアップ（明細行クリック／仮案件作成直後 に開く）。
const projectDialogOpen = ref(false);
const projectDialogId = ref<number | null>(null);
function openProjectDialog(projectId: number | null): void {
  if (projectId === null) return;
  projectDialogId.value = projectId;
  projectDialogOpen.value = true;
}
// 仮案件作成直後に明細編集ダイアログを連続で開く。
async function onManualProjectCreated(project: Project): Promise<void> {
  await reload();
  openProjectDialog(project.id);
}

// 担当者クリック → 原本形（作業区分/顧客名/件名/CD × 12ヶ月）の明細を開く。
const openAssignee = ref<number | null>(null);
async function toggleAssignee(assigneeId: number): Promise<void> {
  if (openAssignee.value === assigneeId) {
    openAssignee.value = null;
    return;
  }
  openAssignee.value = assigneeId;
  expanded.value = null; // セル内訳は閉じる（パネル二重表示を避ける）
  await manhours.fetchAssigneeDetail(assigneeId, {
    fiscalYear: fiscalYear.value,
    batchId: manhours.selectedBatchId,
    organizationId: orgIdParam(),
  });
}

// 明細グリッドの「仮(手入力)」セルを直接編集（確定=取込は参照のみ）。
async function onEditAssigneeManual(
  row: { projectId: number | null; workType: string },
  ym: string,
  raw: string,
): Promise<void> {
  const d = manhours.assigneeDetail;
  if (!d) return;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return;
  await manhours.saveManualEntry({
    assigneeId: d.assigneeId,
    projectId: row.projectId,
    workType: row.workType,
    yearMonth: ym,
    hours,
  });
  await manhours.fetchAssigneeDetail(d.assigneeId, {
    fiscalYear: fiscalYear.value,
    batchId: manhours.selectedBatchId,
    organizationId: orgIdParam(),
  });
  await reload(); // サマリー側も最新化
}

// 担当者明細フッター: 月別の「全体の工数 / 標準時間 / 休暇 / 36(残業)」。
// 36 = 全体の工数 − 標準時間 − 休暇。標準時間は API の capacity（基準時間）。
interface DetailFooterCol {
  total: number;
  capacity: number;
  vacation: number;
  overtime: number;
}
const detailFooter = computed<{
  byMonth: Record<string, DetailFooterCol>;
  grand: DetailFooterCol;
}>(() => {
  const d = manhours.assigneeDetail;
  const empty: DetailFooterCol = {
    total: 0,
    capacity: 0,
    vacation: 0,
    overtime: 0,
  };
  if (!d) return { byMonth: {}, grand: { ...empty } };
  const byMonth: Record<string, DetailFooterCol> = {};
  for (const ym of d.months) {
    byMonth[ym] = { ...empty };
  }
  for (const row of d.rows) {
    const isVacation = row.workType === 'zz' && row.subject === '休暇';
    for (const ym of d.months) {
      const h = row.cells[ym] ?? 0;
      if (h === 0) continue;
      byMonth[ym].total += h;
      if (isVacation) byMonth[ym].vacation += h;
    }
  }
  const grand: DetailFooterCol = { ...empty };
  for (const ym of d.months) {
    const cap = d.capacity[ym] ?? 0;
    byMonth[ym].capacity = cap;
    byMonth[ym].overtime =
      byMonth[ym].total - byMonth[ym].capacity - byMonth[ym].vacation;
    grand.total += byMonth[ym].total;
    grand.capacity += byMonth[ym].capacity;
    grand.vacation += byMonth[ym].vacation;
    grand.overtime += byMonth[ym].overtime;
  }
  return { byMonth, grand };
});

const monthTotals = computed<Record<string, { total: number; base: number }>>(
  () => {
    const acc: Record<string, { total: number; base: number }> = {};
    const s = manhours.summary;
    if (!s) return acc;
    for (const ym of s.months) acc[ym] = { total: 0, base: 0 };
    for (const row of s.rows) {
      for (const ym of s.months) {
        const c = row.cells[ym];
        if (!c) continue;
        acc[ym].total += c.total;
        acc[ym].base += c.base ?? 0;
      }
    }
    return acc;
  },
);
</script>

<template>
  <div class="mh-page">
    <header class="page-header">
      <h2 class="title">稼働見通し（月次工数）</h2>
      <div class="actions">
        <label class="fld">
          <span>年度</span>
          <select v-model.number="fiscalYear">
            <option v-for="y in fyOptions" :key="y" :value="y">{{ y }} 年度</option>
          </select>
        </label>
        <label class="fld">
          <span>取込</span>
          <select v-model.number="manhours.selectedBatchId">
            <option :value="null">最新</option>
            <option v-for="b in manhours.batches" :key="b.id" :value="b.id">
              #{{ b.id }} {{ b.fileName }}
            </option>
          </select>
        </label>
        <label class="fld">
          <span>組織</span>
          <select v-model="orgFilter">
            <option value="all">すべて</option>
            <option value="none">未設定</option>
            <option v-for="o in orgs.byCodeAsc" :key="o.id" :value="o.id">
              {{ orgs.pathOf(o.id) }}
            </option>
          </select>
        </label>
        <div class="seg" role="group" aria-label="表示ソース">
          <button
            class="seg-btn"
            :class="{ active: manhours.showImported }"
            type="button"
            @click="manhours.showImported = !manhours.showImported"
          >確定（取込）</button>
          <button
            class="seg-btn prov"
            :class="{ active: manhours.showProvisional }"
            type="button"
            @click="manhours.showProvisional = !manhours.showProvisional"
          >仮（手入力）</button>
        </div>
        <button class="btn" type="button" @click="manualProjectOpen = true">＋ 仮案件</button>
        <button class="btn primary" type="button" @click="importOpen = true">CSV 取込</button>
      </div>
    </header>

    <p v-if="manhours.error" class="error">{{ manhours.error }}</p>
    <p v-if="manhours.loading" class="muted">読込中…</p>

    <div class="legend" aria-label="セル色の判定基準（36協定/標準時間ベース）">
      <span class="lg-title">セル色 = 36(残業) = 工数 − 標準時間 − 休暇：</span>
      <span class="lg-item"><span class="lg-sw u-under"></span>余裕（標準未達）</span>
      <span class="lg-item"><span class="lg-sw u-ok"></span>健全 (0–30h)</span>
      <span class="lg-item"><span class="lg-sw u-caution"></span>注意 (31–59h)</span>
      <span class="lg-item"><span class="lg-sw u-warn"></span>警告 (60h以上)</span>
    </div>

    <div v-if="manhours.summary && manhours.summary.rows.length" class="grid-wrap">
      <table class="mh-grid">
        <colgroup>
          <col class="c-lead" />
          <col
            v-for="ym in manhours.summary.months"
            :key="ym"
            class="c-mon"
          />
          <col class="c-tot" />
        </colgroup>
        <thead>
          <tr>
            <th class="sticky-col">担当者</th>
            <th v-for="ym in manhours.summary.months" :key="ym">{{ ymLabel(ym) }}</th>
            <th>合計</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in manhours.summary.rows" :key="row.assigneeId">
            <tr>
              <td
                class="sticky-col name clickable"
                :class="{ open: openAssignee === row.assigneeId }"
                title="クリックで担当者の明細（原本形・仮は編集可）を開閉"
                @click="toggleAssignee(row.assigneeId)"
              >{{ row.assigneeName }}</td>
              <td
                v-for="ym in manhours.summary.months"
                :key="ym"
                class="cell"
                :class="utilClass(cellOf(row, ym))"
                :title="
                  cellOf(row, ym)
                    ? `工数 ${cellOf(row, ym)!.total.toFixed(1)}h / 基準 ${
                        cellOf(row, ym)!.base ?? '—'
                      }h / 休暇 ${cellOf(row, ym)!.vacation.toFixed(1)}h` +
                      (overtimeOf(cellOf(row, ym)) !== null
                        ? ` / 36(残業) ${overtimeOf(cellOf(row, ym))!.toFixed(1)}h`
                        : '') +
                      (cellOf(row, ym)!.utilization !== null
                        ? ` / 稼働率 ${(cellOf(row, ym)!.utilization! * 100).toFixed(0)}%`
                        : '')
                    : ''
                "
                @click="toggleExpand(row.assigneeId, ym)"
              >
                <span class="h">{{ fmt(cellOf(row, ym)?.total ?? 0) }}</span>
                <span
                  v-if="cellOf(row, ym) && cellOf(row, ym)!.utilization !== null"
                  class="u"
                >{{ (cellOf(row, ym)!.utilization! * 100).toFixed(0) }}%</span>
              </td>
              <td class="cell total">{{ row.totalHours.toFixed(1) }}</td>
            </tr>
            <tr
              v-if="expanded && expanded.startsWith(row.assigneeId + ':')"
              class="detail-row"
            >
              <td :colspan="manhours.summary.months.length + 2">
                <div class="detail">
                  <strong>
                    {{ row.assigneeName }} / {{ ymLabel(expanded.split(':')[1]) }} の内訳
                  </strong>
                  <table class="detail-grid">
                    <thead>
                      <tr><th>区分</th><th>案件</th><th>作業区分</th><th class="num">工数(h)</th></tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(b, i) in (row.cells[expanded.split(':')[1]]?.byProject ?? [])"
                        :key="i"
                      >
                        <td>
                          <span class="tag" :class="b.source">{{ b.source === 'manual' ? '仮' : '確定' }}</span>
                          <span v-if="b.isProvisional" class="tag prov">仮案件</span>
                        </td>
                        <td>{{ b.projectName }}</td>
                        <td>{{ b.workType || '—' }}</td>
                        <td class="num">
                          <input
                            v-if="b.source === 'manual'"
                            type="number"
                            min="0"
                            step="0.5"
                            class="edit"
                            :value="b.hours"
                            @change="onEditManual(row.assigneeId, expanded.split(':')[1], b, ($event.target as HTMLInputElement).value)"
                          />
                          <template v-else>{{ b.hours.toFixed(1) }}</template>
                        </td>
                      </tr>
                      <tr v-if="!(row.cells[expanded.split(':')[1]]?.byProject ?? []).length">
                        <td colspan="4" class="muted">内訳なし</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </td>
            </tr>
            <tr
              v-if="openAssignee === row.assigneeId && manhours.assigneeDetail"
              class="detail-row"
            >
              <td class="adetail-cell" :colspan="manhours.summary.months.length + 2">
                <div class="adetail-h">
                  <strong>
                    {{ row.assigneeName }} の明細（原本形・<span class="tag manual">仮</span>セルは直接編集可）
                  </strong>
                </div>
                <div class="detail-scroll">
                    <table class="detail-grid orig">
                      <colgroup>
                        <col class="c-cust" />
                        <col class="c-code" />
                        <col class="c-subj" />
                        <col class="c-wt" />
                        <col
                          v-for="ym in manhours.summary.months"
                          :key="ym"
                          class="c-mon"
                        />
                        <col class="c-tot" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>顧客名</th><th>プロジェクトCD</th><th>件名</th><th>作業区分</th>
                          <th v-for="ym in manhours.summary.months" :key="ym" class="num">{{ ymLabel(ym) }}</th>
                          <th class="num">合計</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(d, i) in manhours.assigneeDetail.rows"
                          :key="i"
                          :class="{ 'is-manual': d.source === 'manual', 'row-link': d.projectId !== null }"
                          :title="d.projectId !== null ? 'クリックでこの案件の明細を開く' : ''"
                          @click="openProjectDialog(d.projectId)"
                        >
                          <td :title="d.customerName || ''">{{ d.customerName || '—' }}</td>
                          <td :title="d.projectCode || ''">{{ d.projectCode || '—' }}</td>
                          <td :title="d.subject">{{ d.subject }}</td>
                          <td>
                            {{ d.workType === 'zz' ? d.subject : (d.workType || '—') }}
                            <span class="tag" :class="d.source">{{ d.source === 'manual' ? '仮' : '確定' }}</span>
                          </td>
                          <td
                            v-for="ym in manhours.summary.months"
                            :key="ym"
                            class="num"
                          >
                            <input
                              v-if="d.source === 'manual'"
                              type="number"
                              min="0"
                              step="0.5"
                              class="edit"
                              :value="d.cells[ym] ?? ''"
                              @click.stop
                              @change="onEditAssigneeManual(d, ym, ($event.target as HTMLInputElement).value)"
                            />
                            <template v-else>{{ d.cells[ym] ? d.cells[ym].toFixed(2) : '' }}</template>
                          </td>
                          <td class="num total">{{ d.total.toFixed(2) }}</td>
                        </tr>
                        <tr v-if="!manhours.assigneeDetail.rows.length">
                          <td :colspan="manhours.summary.months.length + 5" class="muted">
                            この担当者の明細はありません
                          </td>
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr class="ft-row ft-total">
                          <td colspan="4" class="ft-label">全体の工数</td>
                          <td v-for="ym in manhours.summary.months" :key="ym" class="num">
                            {{ (detailFooter.byMonth[ym]?.total ?? 0).toFixed(1) }}
                          </td>
                          <td class="num total">{{ detailFooter.grand.total.toFixed(1) }}</td>
                        </tr>
                        <tr class="ft-row ft-base">
                          <td colspan="4" class="ft-label">標準時間</td>
                          <td v-for="ym in manhours.summary.months" :key="ym" class="num">
                            {{ (detailFooter.byMonth[ym]?.capacity ?? 0).toFixed(1) }}
                          </td>
                          <td class="num total">{{ detailFooter.grand.capacity.toFixed(1) }}</td>
                        </tr>
                        <tr class="ft-row ft-vac">
                          <td colspan="4" class="ft-label">休暇</td>
                          <td v-for="ym in manhours.summary.months" :key="ym" class="num">
                            {{ (detailFooter.byMonth[ym]?.vacation ?? 0).toFixed(1) }}
                          </td>
                          <td class="num total">{{ detailFooter.grand.vacation.toFixed(1) }}</td>
                        </tr>
                        <tr class="ft-row ft-ot">
                          <td colspan="4" class="ft-label">36(残業)</td>
                          <td
                            v-for="ym in manhours.summary.months"
                            :key="ym"
                            class="num"
                            :class="{ negative: (detailFooter.byMonth[ym]?.overtime ?? 0) < 0 }"
                          >
                            {{ (detailFooter.byMonth[ym]?.overtime ?? 0).toFixed(1) }}
                          </td>
                          <td
                            class="num total"
                            :class="{ negative: detailFooter.grand.overtime < 0 }"
                          >
                            {{ detailFooter.grand.overtime.toFixed(1) }}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
        <tfoot>
          <tr>
            <td class="sticky-col name">月合計 / 基準</td>
            <td v-for="ym in manhours.summary.months" :key="ym" class="cell foot">
              {{ monthTotals[ym].total.toFixed(0) }}
              <span class="muted small">/ {{ monthTotals[ym].base.toFixed(0) }}</span>
            </td>
            <td class="cell foot"></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-else-if="!manhours.loading" class="muted empty">
      表示できる稼働データがありません。CSV 取込、または仮案件＋手入力で登録してください。
    </p>

    <ManhourImportDialog :open="importOpen" @close="importOpen = false" @committed="onImportCommitted" />
    <ManualProjectDialog
      :open="manualProjectOpen"
      @close="manualProjectOpen = false"
      @created="onManualProjectCreated"
    />
    <ProjectDetailDialog
      :open="projectDialogOpen"
      :project-id="projectDialogId"
      :fiscal-year="fiscalYear"
      @close="projectDialogOpen = false"
      @saved="async () => { if (openAssignee !== null) { await manhours.fetchAssigneeDetail(openAssignee, { fiscalYear, batchId: manhours.selectedBatchId, organizationId: orgIdParam() }); } await reload(); }"
    />
  </div>
</template>

<style scoped>
.mh-page {
  display: flex; flex-direction: column; gap: 1rem;
  /* サマリーと展開明細で月列を縦に揃えるための共通幅 */
  --mh-lead: 19rem;  /* 先頭ブロック幅（サマリー=担当者列 / 明細=顧客名+CD+件名+区分） */
  --mh-mw: 3.7rem;   /* 月1列の幅（両テーブル共通・件名を詰めた分を拡大） */
  --mh-tot: 4.2rem;  /* 合計列の幅 */
}
.page-header {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: var(--r); padding: 0.6rem 0.9rem; box-shadow: var(--shadow-sm);
}
.title { margin: 0; font-size: 1.1rem; flex: 1; }
.actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.fld { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; color: var(--c-text-muted); }
.seg { display: inline-flex; border: 1px solid var(--c-border-strong); border-radius: var(--r); overflow: hidden; }
.seg-btn {
  border: none; background: var(--c-surface); color: var(--c-text-muted);
  padding: 0.35rem 0.7rem; font-size: 0.82rem; border-right: 1px solid var(--c-border);
}
.seg-btn:last-child { border-right: none; }
.seg-btn.active { background: var(--c-accent-weak); color: var(--c-accent-strong); font-weight: 600; }
.seg-btn.prov.active { background: var(--c-warn-bg); color: var(--c-warn-fg); }
.grid-wrap { overflow: auto; border: 1px solid var(--c-border); border-radius: var(--r); background: var(--c-surface); }
.mh-grid { border-collapse: collapse; width: 100%; font-size: 0.85rem; table-layout: fixed; }
.mh-grid th, .mh-grid td {
  border-bottom: 1px solid var(--c-border); border-right: 1px solid var(--c-border);
  padding: 0.3rem 0.4rem; text-align: right; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
/* 列幅（colgroup）。サマリーと明細で月幅・先頭幅を一致させる */
.mh-grid col.c-lead { width: var(--mh-lead); }
.mh-grid col.c-mon { width: var(--mh-mw); }
.mh-grid col.c-tot { width: var(--mh-tot); }
/* 合計は --mh-lead(24rem) を維持＝月列はサマリーと縦に揃ったまま。
   顧客名/CD を狭め、余りは件名へ。 */
.detail-grid.orig col.c-cust { width: 4.5rem; }
.detail-grid.orig col.c-code { width: 5.5rem; }
.detail-grid.orig col.c-subj { width: 5rem; }
.detail-grid.orig col.c-wt { width: 4rem; }
.detail-grid.orig col.c-mon { width: var(--mh-mw); }
.detail-grid.orig col.c-tot { width: var(--mh-tot); }
.mh-grid thead th {
  background: var(--c-surface-2); color: var(--c-text-muted);
  position: sticky; top: 0; z-index: 2; font-weight: 600;
}
.sticky-col {
  position: sticky; left: 0; background: var(--c-surface); text-align: left;
  z-index: 1;
}
thead .sticky-col { z-index: 3; background: var(--c-surface-2); }
.name { font-weight: 600; }
.cell { cursor: pointer; }
.cell .u { display: block; font-size: 0.68rem; color: var(--c-text-faint); }
/* 36(残業) ベースの 4 段階色分け。
   - u-under (余裕)    : 標準未達。寒色で「余力あり・配置検討材料」を示す。
   - u-ok    (健全)    : 残業 0-30h。緑系で問題なし。
   - u-caution(注意)   : 残業 31-59h。36協定 45h 接近の黄色警告。
   - u-warn  (警告)    : 残業 60h 以上。赤＋濃赤文字＋太字で強調。 */
.cell.u-under { background: #dbeafe; }
.cell.u-ok { background: var(--c-ok-bg); }
.cell.u-caution { background: var(--c-late-bg); }
.cell.u-warn { background: var(--c-danger-bg); color: var(--c-danger-fg); font-weight: 700; }
.legend {
  display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap;
  font-size: 0.8rem; color: var(--c-text-muted); padding: 0.2rem 0.1rem;
}
.lg-title { color: var(--c-text); font-weight: 600; }
.lg-item { display: inline-flex; align-items: center; gap: 0.3rem; }
.lg-sw {
  display: inline-block; width: 0.9rem; height: 0.9rem; border-radius: 3px;
  border: 1px solid var(--c-border);
}
.lg-sw.u-under { background: #dbeafe; }
.lg-sw.u-ok { background: var(--c-ok-bg); }
.lg-sw.u-caution { background: var(--c-late-bg); }
.lg-sw.u-warn { background: var(--c-danger-bg); }
.cell.total { font-weight: 700; background: var(--c-surface-2); }
.cell.foot { font-weight: 600; background: var(--c-surface-3); }
.detail-row td { background: var(--c-surface-2); text-align: left; }
.detail { padding: 0.4rem 0.6rem; }
.detail-grid {
  margin-top: 0.35rem; border-collapse: collapse; font-size: 0.82rem;
  background: var(--c-surface); min-width: 28rem;
}
.detail-grid th, .detail-grid td {
  border: 1px solid var(--c-border); padding: 0.2rem 0.5rem;
  text-align: left; white-space: nowrap;
}
.detail-grid thead th {
  background: var(--c-surface-2); color: var(--c-text-muted); font-weight: 600;
}
.detail-grid .num { text-align: right; }
.detail-grid input.edit {
  width: 100%;
  box-sizing: border-box;
  text-align: right;
  padding: 0.1rem 0.3rem;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
  appearance: textfield;
}
.detail-grid input.edit::-webkit-outer-spin-button,
.detail-grid input.edit::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.name.clickable { cursor: pointer; }
.name.clickable:hover { color: var(--c-accent-strong); text-decoration: underline; }
.name.clickable.open { background: var(--c-accent-weak); color: var(--c-accent-strong); }
/* 担当者明細セル: 余白0でテーブルを行頭に揃え、月列をサマリーと一致させる */
.adetail-cell { padding: 0 !important; }
.adetail-h { padding: 0.4rem 0.6rem; }
.detail-scroll { margin-top: 0; }
/* サマリーと同じ固定レイアウト＆同幅。td 幅は colgroup に従う */
.detail-grid.orig { width: 100%; table-layout: fixed; }
.detail-grid.orig th, .detail-grid.orig td {
  overflow: hidden; text-overflow: ellipsis;
}
.detail-grid.orig td.total { font-weight: 700; background: var(--c-surface-2); }
.detail-grid tr.is-manual { background: var(--c-warn-bg); }
.detail-grid tr.is-manual input.edit { background: var(--c-surface); }
.detail-grid tr.row-link { cursor: pointer; }
.detail-grid tr.row-link:hover td { background: var(--c-accent-weak); }
.detail-grid tfoot .ft-row td {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  border-top: 1px solid var(--c-border-strong);
  background: var(--c-surface-2);
}
.detail-grid tfoot .ft-label { text-align: right; color: var(--c-text-muted); }
.detail-grid tfoot .ft-total td { background: var(--c-surface-3); }
.detail-grid tfoot .ft-ot td.num { color: var(--c-accent-strong); }
.detail-grid tfoot .ft-ot td.negative { color: var(--c-text-muted); }
.detail-grid tfoot td.total { background: var(--c-surface-3); }
.tag {
  display: inline-block; font-size: 0.7rem; padding: 0.02rem 0.35rem;
  border-radius: 3px; margin-right: 0.25rem;
}
.tag.imported { background: var(--c-accent-weak); color: var(--c-accent-strong); }
.tag.manual, .tag.prov { background: var(--c-warn-bg); color: var(--c-warn-fg); }
.muted { color: var(--c-text-muted); }
.muted.small { font-size: 0.75rem; }
.empty { padding: 2rem; text-align: center; }
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); margin: 0;
}
</style>
