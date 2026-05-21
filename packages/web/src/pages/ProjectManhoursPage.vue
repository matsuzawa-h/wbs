<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useManhoursStore } from '@/stores/manhours';
import { useEmployeesStore } from '@/stores/employees';
import type { Employee, MatrixCell } from '@/types';

const props = defineProps<{ projectId: number }>();
const router = useRouter();
const manhours = useManhoursStore();
const employees = useEmployeesStore();

function currentFiscalYear(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
const fiscalYear = ref<number>(currentFiscalYear());
const fyOptions = computed<number[]>(() => {
  const b = currentFiscalYear();
  return [b + 1, b, b - 1, b - 2];
});

// 手入力で行を足したい担当者（マトリクスに未出現の人）
const extraAssigneeId = ref<number | null>(null);
const extraRows = ref<Employee[]>([]);

// 編集中セル
const editKey = ref<string | null>(null);
const editVal = ref<string>('');

async function reload(): Promise<void> {
  await manhours.fetchProjectMatrix(props.projectId, {
    fiscalYear: fiscalYear.value,
    batchId: manhours.selectedBatchId,
  });
}

onMounted(async () => {
  await Promise.all([employees.fetchAll(), reload()]);
});
watch(
  () => [
    props.projectId,
    fiscalYear.value,
    manhours.selectedBatchId,
    manhours.showImported,
    manhours.showProvisional,
  ],
  reload,
);

function ymLabel(ym: string): string {
  return `${Number(ym.split('-')[1])}月`;
}

interface DisplayRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, MatrixCell>;
  total: number;
}

const rows = computed<DisplayRow[]>(() => {
  const mx = manhours.projectMatrix;
  const base: DisplayRow[] = mx ? mx.rows.map((r) => ({ ...r })) : [];
  const present = new Set(base.map((r) => r.assigneeId));
  for (const e of extraRows.value) {
    if (!present.has(e.id)) {
      base.push({
        assigneeId: e.id,
        assigneeName: e.name,
        cells: {},
        total: 0,
      });
    }
  }
  return base;
});

const months = computed<string[]>(() => manhours.projectMatrix?.months ?? []);

function addExtraRow(): void {
  const id = extraAssigneeId.value;
  if (id === null) return;
  const e = employees.items.find((x) => x.id === id);
  if (e && !extraRows.value.some((r) => r.id === id)) extraRows.value.push(e);
  extraAssigneeId.value = null;
}

function startEdit(assigneeId: number, ym: string, cell?: MatrixCell): void {
  editKey.value = `${assigneeId}:${ym}`;
  editVal.value = cell ? String(cell.manual || '') : '';
}

async function commitEdit(assigneeId: number, ym: string): Promise<void> {
  const hours = Number(editVal.value);
  editKey.value = null;
  if (!Number.isFinite(hours) || hours < 0) return;
  await manhours.saveManualEntry({
    assigneeId,
    projectId: props.projectId,
    yearMonth: ym,
    hours,
  });
  await reload();
}

function back(): void {
  router.push({ name: 'gantt', params: { projectId: props.projectId } });
}
</script>

<template>
  <div class="mh-page">
    <header class="page-header">
      <button class="btn" type="button" @click="back">← 工程表へ</button>
      <h2 class="title">
        <span v-if="manhours.projectMatrix">
          <span v-if="manhours.projectMatrix.isProvisional" class="tag prov">仮</span>
          {{ manhours.projectMatrix.projectName }}
          <span v-if="manhours.projectMatrix.projectCode" class="muted small">
            ({{ manhours.projectMatrix.projectCode }})
          </span>
          の月次工数
        </span>
        <span v-else class="muted">プロジェクト #{{ projectId }}</span>
      </h2>
      <div class="actions">
        <label class="fld">
          <span>年度</span>
          <select v-model.number="fiscalYear">
            <option v-for="y in fyOptions" :key="y" :value="y">{{ y }} 年度</option>
          </select>
        </label>
        <div class="seg" role="group" aria-label="表示ソース">
          <button
            class="seg-btn"
            :class="{ active: manhours.showImported }"
            type="button"
            @click="manhours.showImported = !manhours.showImported"
          >確定</button>
          <button
            class="seg-btn prov"
            :class="{ active: manhours.showProvisional }"
            type="button"
            @click="manhours.showProvisional = !manhours.showProvisional"
          >仮</button>
        </div>
      </div>
    </header>

    <p v-if="manhours.error" class="error">{{ manhours.error }}</p>
    <p v-if="manhours.loading" class="muted">読込中…</p>

    <div v-if="manhours.projectMatrix" class="grid-wrap">
      <table class="mh-grid">
        <thead>
          <tr>
            <th class="sticky-col">担当者</th>
            <th v-for="ym in months" :key="ym">{{ ymLabel(ym) }}</th>
            <th>合計</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.assigneeId">
            <td class="sticky-col name">{{ row.assigneeName }}</td>
            <td
              v-for="ym in months"
              :key="ym"
              class="cell"
              @dblclick="startEdit(row.assigneeId, ym, row.cells[ym])"
            >
              <input
                v-if="editKey === `${row.assigneeId}:${ym}`"
                v-model="editVal"
                class="edit"
                type="number"
                min="0"
                step="0.5"
                @keyup.enter="commitEdit(row.assigneeId, ym)"
                @blur="commitEdit(row.assigneeId, ym)"
              />
              <template v-else>
                <span class="h">{{ (row.cells[ym]?.total ?? 0) || '' }}</span>
                <span
                  v-if="row.cells[ym] && row.cells[ym].manual > 0"
                  class="m"
                  title="うち手入力(仮)"
                >仮{{ row.cells[ym].manual }}</span>
              </template>
            </td>
            <td class="cell total">{{ row.total.toFixed(1) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td class="sticky-col name">月合計</td>
            <td v-for="ym in months" :key="ym" class="cell foot">
              {{ (manhours.projectMatrix.monthTotals[ym] ?? 0).toFixed(1) }}
            </td>
            <td class="cell foot">{{ manhours.projectMatrix.grandTotal.toFixed(1) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-else-if="!manhours.loading" class="muted empty">工数データがありません。</p>

    <div class="add-row">
      <span class="muted small">セルをダブルクリックで手入力（仮）。担当者行を追加：</span>
      <select v-model.number="extraAssigneeId">
        <option :value="null">（担当者を選択）</option>
        <option v-for="e in employees.byCodeAsc" :key="e.id" :value="e.id">
          {{ e.code ? `[${e.code}] ` : '' }}{{ e.name }}
        </option>
      </select>
      <button class="btn small" type="button" :disabled="extraAssigneeId === null" @click="addExtraRow">行追加</button>
    </div>
  </div>
</template>

<style scoped>
.mh-page { display: flex; flex-direction: column; gap: 1rem; }
.page-header {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  background: var(--c-surface); border: 1px solid var(--c-border);
  border-radius: var(--r); padding: 0.6rem 0.9rem; box-shadow: var(--shadow-sm);
}
.title { margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--c-text); letter-spacing: 0.005em; flex: 1; }
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
.cell { cursor: cell; }
.cell .m { display: block; font-size: 0.66rem; color: var(--c-warn-fg); }
.cell.total { font-weight: 700; background: var(--c-surface-2); }
.cell.foot { font-weight: 600; background: var(--c-surface-3); }
.edit { width: 4rem; text-align: right; padding: 0.1rem 0.2rem; }
.add-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.tag {
  display: inline-block; font-size: 0.7rem; padding: 0.02rem 0.35rem;
  border-radius: 3px; margin-right: 0.25rem; background: var(--c-warn-bg); color: var(--c-warn-fg);
}
.muted { color: var(--c-text-muted); }
.muted.small { font-size: 0.75rem; }
.empty { padding: 2rem; text-align: center; }
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); margin: 0;
}
</style>
