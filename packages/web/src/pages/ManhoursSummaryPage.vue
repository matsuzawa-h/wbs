<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useManhoursStore } from '@/stores/manhours';
import ManhourImportDialog from '@/components/ManhourImportDialog.vue';
import ManualProjectDialog from '@/components/ManualProjectDialog.vue';
import type { SummaryCell } from '@/types';

const manhours = useManhoursStore();

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
const fiscalYear = ref<number>(currentFiscalYear());
const importOpen = ref(false);
const manualProjectOpen = ref(false);
// 展開中セル `${assigneeId}:${ym}`
const expanded = ref<string | null>(null);

const fyOptions = computed<number[]>(() => {
  const b = currentFiscalYear();
  return [b + 1, b, b - 1, b - 2];
});

async function reload(): Promise<void> {
  await manhours.fetchBatches(fiscalYear.value);
  await manhours.fetchSummary({
    fiscalYear: fiscalYear.value,
    batchId: manhours.selectedBatchId,
  });
}

onMounted(reload);
watch(
  () => [
    fiscalYear.value,
    manhours.selectedBatchId,
    manhours.showImported,
    manhours.showProvisional,
  ],
  reload,
);

function ymLabel(ym: string): string {
  const [, m] = ym.split('-');
  return `${Number(m)}月`;
}

function fmt(n: number): string {
  return n === 0 ? '' : n.toFixed(1);
}

// 稼働率による色分け（>100% 逼迫 / 85%↑ 高 / それ以下 健全）。
function utilClass(cell: SummaryCell | undefined): string {
  if (!cell || cell.base === null || cell.utilization === null) return '';
  if (cell.utilization > 1.0) return 'u-over';
  if (cell.utilization >= 0.85) return 'u-high';
  if (cell.total > 0) return 'u-ok';
  return '';
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

    <div v-if="manhours.summary && manhours.summary.rows.length" class="grid-wrap">
      <table class="mh-grid">
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
              <td class="sticky-col name">{{ row.assigneeName }}</td>
              <td
                v-for="ym in manhours.summary.months"
                :key="ym"
                class="cell"
                :class="utilClass(cellOf(row, ym))"
                :title="
                  cellOf(row, ym)
                    ? `工数 ${cellOf(row, ym)!.total.toFixed(1)}h / 基準 ${
                        cellOf(row, ym)!.base ?? '—'
                      }h` +
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
                  <ul>
                    <li
                      v-for="(b, i) in (row.cells[expanded.split(':')[1]]?.byProject ?? [])"
                      :key="i"
                    >
                      <span class="tag" :class="b.source">{{ b.source === 'manual' ? '仮' : '確定' }}</span>
                      <span v-if="b.isProvisional" class="tag prov">仮案件</span>
                      {{ b.projectName }}
                      <span v-if="b.workType" class="muted small">[{{ b.workType }}]</span>
                      … <strong>{{ b.hours.toFixed(1) }} h</strong>
                    </li>
                    <li v-if="!(row.cells[expanded.split(':')[1]]?.byProject ?? []).length" class="muted">
                      内訳なし
                    </li>
                  </ul>
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

    <ManhourImportDialog :open="importOpen" @close="importOpen = false" @committed="reload" />
    <ManualProjectDialog
      :open="manualProjectOpen"
      @close="manualProjectOpen = false"
      @created="reload"
    />
  </div>
</template>

<style scoped>
.mh-page { display: flex; flex-direction: column; gap: 1rem; }
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
.mh-grid { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
.mh-grid th, .mh-grid td {
  border-bottom: 1px solid var(--c-border); border-right: 1px solid var(--c-border);
  padding: 0.3rem 0.5rem; text-align: right; white-space: nowrap;
}
.mh-grid thead th {
  background: var(--c-surface-2); color: var(--c-text-muted);
  position: sticky; top: 0; z-index: 2; font-weight: 600;
}
.sticky-col {
  position: sticky; left: 0; background: var(--c-surface); text-align: left;
  z-index: 1; min-width: 8rem;
}
thead .sticky-col { z-index: 3; background: var(--c-surface-2); }
.name { font-weight: 600; }
.cell { cursor: pointer; }
.cell .u { display: block; font-size: 0.68rem; color: var(--c-text-faint); }
.cell.u-ok { background: var(--c-ok-bg); }
.cell.u-high { background: var(--c-late-bg); }
.cell.u-over { background: var(--c-danger-bg); color: var(--c-danger-fg); font-weight: 700; }
.cell.total { font-weight: 700; background: var(--c-surface-2); }
.cell.foot { font-weight: 600; background: var(--c-surface-3); }
.detail-row td { background: var(--c-surface-2); text-align: left; }
.detail { padding: 0.4rem 0.6rem; }
.detail ul { margin: 0.3rem 0 0; padding-left: 1rem; }
.detail li { margin: 0.15rem 0; }
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
