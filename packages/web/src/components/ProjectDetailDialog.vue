<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useManhoursStore } from '@/stores/manhours';
import { useEmployeesStore } from '@/stores/employees';
import type { Employee, MatrixCell, MatrixRow } from '@/types';

const props = defineProps<{
  open: boolean;
  projectId: number | null;
  fiscalYear: number;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'saved'): void;
}>();

const manhours = useManhoursStore();
const employees = useEmployeesStore();

// 仮プロジェクトのみメンバー編集（担当者の追加/削除）と工数編集を許可。
const isProvisional = computed(
  () => manhours.projectMatrix?.isProvisional ?? false,
);

// ダイアログ内ローカルに追加した「メンバー」（まだ entry が無い担当者）。
const extraRowIds = ref<number[]>([]);
const addAssigneeId = ref<number | null>(null);
const dirty = ref(false);

async function reload(): Promise<void> {
  if (props.projectId === null) return;
  await manhours.fetchProjectMatrix(props.projectId, {
    fiscalYear: props.fiscalYear,
    batchId: manhours.selectedBatchId,
  });
}

watch(
  () => [props.open, props.projectId],
  async ([open, pid]) => {
    if (!open || pid === null) return;
    extraRowIds.value = [];
    addAssigneeId.value = null;
    dirty.value = false;
    await Promise.all([employees.fetchAll(), reload()]);
  },
  { immediate: false },
);

// 表示用: マトリクス行 + 追加メンバー行を結合
interface DisplayRow {
  assigneeId: number;
  assigneeName: string;
  cells: Record<string, MatrixCell>;
  total: number;
  extra: boolean; // ローカル追加（未保存）
}
const displayRows = computed<DisplayRow[]>(() => {
  const mx = manhours.projectMatrix;
  const base: DisplayRow[] = mx
    ? mx.rows.map((r) => ({ ...r, extra: false }))
    : [];
  const present = new Set(base.map((r) => r.assigneeId));
  for (const id of extraRowIds.value) {
    if (present.has(id)) continue;
    const e = employees.items.find((x) => x.id === id);
    if (!e) continue;
    base.push({
      assigneeId: e.id,
      assigneeName: e.name,
      cells: {},
      total: 0,
      extra: true,
    });
  }
  return base;
});

const monthLabel = (ym: string): string => `${Number(ym.split('-')[1])}月`;

const availableEmployees = computed<Employee[]>(() => {
  const present = new Set(displayRows.value.map((r) => r.assigneeId));
  return employees.byCodeAsc.filter((e) => !present.has(e.id));
});

function addRow(): void {
  if (addAssigneeId.value === null) return;
  if (!extraRowIds.value.includes(addAssigneeId.value))
    extraRowIds.value.push(addAssigneeId.value);
  addAssigneeId.value = null;
}

async function onEditCell(
  assigneeId: number,
  ym: string,
  raw: string,
): Promise<void> {
  if (props.projectId === null) return;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return;
  await manhours.saveManualEntry({
    assigneeId,
    projectId: props.projectId,
    workType: '',
    yearMonth: ym,
    hours,
  });
  dirty.value = true;
  await reload();
}

async function removeRow(assigneeId: number): Promise<void> {
  if (props.projectId === null) return;
  const mx = manhours.projectMatrix;
  if (!mx) return;
  const row = mx.rows.find((r) => r.assigneeId === assigneeId);
  if (!row) {
    // 追加だけして未保存 → ローカル削除のみ
    extraRowIds.value = extraRowIds.value.filter((id) => id !== assigneeId);
    return;
  }
  // 各月の手入力を 0 で upsert（サービス側で削除）
  if (
    !confirm(
      `${row.assigneeName} のこの案件への手入力(仮)を全月削除します。よろしいですか？`,
    )
  )
    return;
  for (const ym of mx.months) {
    const cell = row.cells[ym];
    if (cell && cell.manual > 0) {
      await manhours.saveManualEntry({
        assigneeId,
        projectId: props.projectId,
        workType: '',
        yearMonth: ym,
        hours: 0,
      });
    }
  }
  extraRowIds.value = extraRowIds.value.filter((id) => id !== assigneeId);
  dirty.value = true;
  await reload();
}

function onClose(): void {
  if (dirty.value) emit('saved');
  emit('close');
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="onClose">
    <div class="modal" role="dialog" aria-label="プロジェクト明細">
      <header class="modal-header">
        <h2>
          <span v-if="manhours.projectMatrix">
            <span v-if="isProvisional" class="tag prov">仮</span>
            {{ manhours.projectMatrix.projectName }}
            <span v-if="manhours.projectMatrix.projectCode" class="muted small">
              ({{ manhours.projectMatrix.projectCode }})
            </span>
          </span>
          <span v-else class="muted">プロジェクト #{{ projectId }}</span>
        </h2>
        <button class="icon-btn" type="button" @click="onClose" aria-label="閉じる">×</button>
      </header>

      <div class="modal-body">
        <p v-if="manhours.error" class="error">{{ manhours.error }}</p>
        <p v-if="manhours.loading" class="muted">読込中…</p>

        <p v-if="!isProvisional" class="muted small">
          このプロジェクトは <strong>確定（仮ではない）</strong>のため参照表示のみです。
          編集は再取込、または仮プロジェクトを別途作成して手入力してください。
        </p>

        <div v-if="manhours.projectMatrix" class="grid-wrap">
          <table class="dlg-grid">
            <thead>
              <tr>
                <th class="sticky-col">担当者</th>
                <th v-for="ym in manhours.projectMatrix.months" :key="ym" class="num">
                  {{ monthLabel(ym) }}
                </th>
                <th class="num">合計</th>
                <th v-if="isProvisional" class="op"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in displayRows" :key="row.assigneeId">
                <td class="sticky-col name">{{ row.assigneeName }}</td>
                <td
                  v-for="ym in manhours.projectMatrix.months"
                  :key="ym"
                  class="num cell"
                  :class="{ editable: isProvisional }"
                >
                  <input
                    v-if="isProvisional"
                    type="number"
                    min="0"
                    step="0.5"
                    class="edit"
                    :value="row.cells[ym]?.manual ?? ''"
                    @change="onEditCell(row.assigneeId, ym, ($event.target as HTMLInputElement).value)"
                  />
                  <template v-else>
                    {{ row.cells[ym]?.total ? row.cells[ym]!.total.toFixed(1) : '' }}
                  </template>
                  <span
                    v-if="!isProvisional && row.cells[ym] && row.cells[ym]!.imported > 0 && row.cells[ym]!.manual > 0"
                    class="muted small"
                  >
                    （仮 {{ row.cells[ym]!.manual }}）
                  </span>
                </td>
                <td class="num total">{{ row.total.toFixed(1) }}</td>
                <td v-if="isProvisional" class="op">
                  <button class="btn small danger" type="button" @click="removeRow(row.assigneeId)">削除</button>
                </td>
              </tr>
              <tr v-if="!displayRows.length">
                <td :colspan="manhours.projectMatrix.months.length + (isProvisional ? 3 : 2)" class="muted">
                  この案件の明細はありません
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="sticky-col name">月合計</td>
                <td v-for="ym in manhours.projectMatrix.months" :key="ym" class="num foot">
                  {{ (manhours.projectMatrix.monthTotals[ym] ?? 0).toFixed(1) }}
                </td>
                <td class="num foot">{{ manhours.projectMatrix.grandTotal.toFixed(1) }}</td>
                <td v-if="isProvisional" class="op foot"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-if="isProvisional" class="add-row">
          <span class="muted small">メンバー追加:</span>
          <select v-model.number="addAssigneeId">
            <option :value="null">（担当者を選択）</option>
            <option v-for="e in availableEmployees" :key="e.id" :value="e.id">{{ e.code ? `[${e.code}] ` : '' }}{{ e.name }}</option>
          </select>
          <button class="btn small" type="button" :disabled="addAssigneeId === null" @click="addRow">行追加</button>
          <span class="muted small">追加後、月セルに工数を入れると保存されます（0 で削除）。</span>
        </div>
      </div>

      <footer class="modal-footer">
        <button class="btn primary" type="button" @click="onClose">閉じる</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.modal {
  background: var(--c-surface); border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop); width: min(1100px, 96vw);
  max-height: 92vh; display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--c-border);
}
.modal-header h2 { margin: 0; font-size: 1.05rem; }
.icon-btn { border: none; background: none; font-size: 1.4rem; cursor: pointer; color: var(--c-text-muted); }
.modal-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.7rem; overflow-y: auto; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding: 0.5rem 1rem; border-top: 1px solid var(--c-border);
}
.grid-wrap { overflow: auto; border: 1px solid var(--c-border); border-radius: var(--r); background: var(--c-surface); }
.dlg-grid { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
.dlg-grid th, .dlg-grid td {
  border-bottom: 1px solid var(--c-border); border-right: 1px solid var(--c-border);
  padding: 0.25rem 0.45rem; text-align: right; white-space: nowrap;
}
.dlg-grid thead th { background: var(--c-surface-2); color: var(--c-text-muted); font-weight: 600; }
.sticky-col { position: sticky; left: 0; background: var(--c-surface); text-align: left; z-index: 1; min-width: 8rem; }
thead .sticky-col { z-index: 3; background: var(--c-surface-2); }
.name { font-weight: 600; }
.num { text-align: right; }
.cell.editable { background: var(--c-warn-bg); }
.cell.editable input.edit { background: var(--c-surface); width: 4rem; text-align: right; padding: 0.1rem 0.3rem; }
.total { font-weight: 700; background: var(--c-surface-2); }
.foot { font-weight: 600; background: var(--c-surface-3); }
.op { text-align: center; }
.add-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); margin: 0;
}
.tag {
  display: inline-block; font-size: 0.7rem; padding: 0.02rem 0.35rem;
  border-radius: 3px; margin-right: 0.25rem; background: var(--c-warn-bg); color: var(--c-warn-fg);
}
.muted { color: var(--c-text-muted); }
.muted.small { font-size: 0.78rem; }
</style>
