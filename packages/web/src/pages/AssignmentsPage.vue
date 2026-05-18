<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useEmployeesStore } from '@/stores/employees';
import { useProjectsStore } from '@/stores/projects';
import { computeStatus, STATUS_BUCKETS, type StatusBucket, todayUtc } from '@/utils/status';
import ColumnFilter, { type FilterOption } from '@/components/ColumnFilter.vue';
import TaskNoteDialog from '@/components/TaskNoteDialog.vue';
import type { AssignmentRow, PersonalTask } from '@/types';

type FilterValue = string | number | null;
// Unified row for the table: a WBS assignment or a personal task. Personal
// tasks are mapped onto the AssignmentRow shape so the existing table /
// filters / inline-edit work unchanged; `kind` routes saves & actions.
type Row = AssignmentRow & { kind: 'wbs' | 'personal' };
const PERSONAL_LABEL = '（個人タスク）';

const router = useRouter();
const employees = useEmployeesStore();
const projects = useProjectsStore();

const selectedId = ref<number | null>(null);
const periodFilter = ref<'all' | 'in-progress' | 'this-month' | 'future'>('all');
// Default: show everything EXCEPT 完了 (the 'completed' bucket also covers
// 完了遅れ). Users usually want to see outstanding work first.
const statusFilter = ref<Set<StatusBucket> | null>(
  new Set(
    STATUS_BUCKETS.map((b) => b.bucket).filter((b) => b !== 'completed'),
  ),
);
const rows = ref<Row[]>([]);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

// --- Excel-style column filters (header ▾ popovers) ---
const nameFilter = ref('');
const breadcrumbFilter = ref('');
const projectFilter = ref<Set<FilterValue> | null>(null);
type FilterKey = 'project' | 'name' | 'breadcrumb' | 'status';
const openFilter = ref<FilterKey | null>(null);

function toggleFilter(key: FilterKey): void {
  openFilter.value = openFilter.value === key ? null : key;
}
function closeFilter(): void {
  openFilter.value = null;
}
function isFilterActive(key: FilterKey): boolean {
  if (key === 'name') return nameFilter.value !== '';
  if (key === 'breadcrumb') return breadcrumbFilter.value !== '';
  if (key === 'project') return projectFilter.value !== null;
  return statusFilter.value !== null;
}

const projectOptions = computed<FilterOption[]>(() => {
  const names = [...new Set(rows.value.map((r) => r.projectName))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );
  return names.map((n) => ({ value: n, label: n }));
});
const statusOptions = computed<FilterOption[]>(() =>
  STATUS_BUCKETS.map((b) => ({ value: b.bucket, label: b.label })),
);

function setProjectFilter(v: Set<FilterValue> | null): void {
  projectFilter.value = v;
}
function setStatusColFilter(v: Set<FilterValue> | null): void {
  statusFilter.value = v as Set<StatusBucket> | null;
}

onMounted(async () => {
  await Promise.all([employees.fetchAll(), projects.fetchAll()]);
  if (selectedId.value === null && employees.activeItems.length > 0) {
    selectedId.value = employees.activeItems[0].id;
  }
});

function onProjectChange(r: Row, e: Event): void {
  const raw = (e.target as HTMLSelectElement).value;
  const v = raw === '' ? null : Number(raw);
  if (v !== (r.projectId || null)) patchTask(r, { projectId: v });
}

const saving = ref(false);

function personalToRow(p: PersonalTask): Row {
  return {
    id: p.id,
    projectId: p.projectId ?? 0,
    projectName: p.projectName ?? PERSONAL_LABEL,
    level: 3,
    parentId: null,
    name: p.name,
    startDate: p.startDate,
    duration: p.duration,
    endDate: p.endDate,
    actualStartDate: p.actualStartDate,
    actualEndDate: p.actualEndDate,
    plannedHours: p.plannedHours,
    actualHours: p.actualHours,
    progress: p.progress,
    assigneeId: p.employeeId,
    status: '',
    note: p.note,
    parentName: null,
    grandparentName: null,
    kind: 'personal',
  };
}

async function loadRows(id: number | null): Promise<void> {
  if (id === null) {
    rows.value = [];
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const [wbs, personal] = await Promise.all([
      api.get<AssignmentRow[]>(`/employees/${id}/tasks`),
      api.get<PersonalTask[]>(`/employees/${id}/personal-tasks`),
    ]);
    const merged: Row[] = [
      ...wbs.data.map((r) => ({ ...r, kind: 'wbs' as const })),
      ...personal.data.map(personalToRow),
    ];
    merged.sort((a, b) => {
      const as = a.startDate ?? '9999-99-99';
      const bs = b.startDate ?? '9999-99-99';
      return as < bs ? -1 : as > bs ? 1 : a.id - b.id;
    });
    rows.value = merged;
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '読み込みに失敗しました';
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

watch(selectedId, (id) => loadRows(id));

// Inline edit → PATCH the right endpoint by row kind, then reload so
// cascaded dates / filtered visibility stay correct. WBS edits use the
// server cascade default (ON), matching the gantt.
async function patchTask(
  r: Row,
  patch: Record<string, unknown>,
): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    const url =
      r.kind === 'personal' ? `/personal-tasks/${r.id}` : `/tasks/${r.id}`;
    await api.patch(url, patch);
    await loadRows(selectedId.value);
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '更新に失敗しました';
  } finally {
    saving.value = false;
  }
}

async function addPersonalTask(): Promise<void> {
  if (selectedId.value === null || saving.value) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    await api.post(`/employees/${selectedId.value}/personal-tasks`, {
      name: '',
    });
    await loadRows(selectedId.value);
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '個人タスクの追加に失敗しました';
  } finally {
    saving.value = false;
  }
}

async function removePersonalTask(r: Row): Promise<void> {
  if (saving.value) return;
  if (!window.confirm(`個人タスク「${r.name || '（名称未入力）'}」を削除します。よろしいですか？`)) {
    return;
  }
  saving.value = true;
  errorMessage.value = null;
  try {
    await api.delete(`/personal-tasks/${r.id}`);
    await loadRows(selectedId.value);
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '削除に失敗しました';
  } finally {
    saving.value = false;
  }
}

// 備考 popup (shared TaskNoteDialog component).
const noteRow = ref<Row | null>(null);
function openNote(r: Row): void {
  noteRow.value = r;
}
async function onSaveNote(note: string | null): Promise<void> {
  const r = noteRow.value;
  if (!r) return;
  await patchTask(r, { note });
  noteRow.value = null;
}

function inputValue(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

function onName(r: Row, e: Event): void {
  const v = inputValue(e);
  if (v !== r.name) patchTask(r, { name: v });
}
function onStart(r: Row, e: Event): void {
  const v = inputValue(e);
  if (v && v !== r.startDate) patchTask(r, { startDate: v });
}
function onDuration(r: Row, e: Event): void {
  const n = Number(inputValue(e));
  if (Number.isFinite(n) && n > 0 && n !== r.duration) {
    patchTask(r, { duration: n });
  }
}
function onProgress(r: Row, e: Event): void {
  const n = Number(inputValue(e));
  if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== r.progress) {
    patchTask(r, { progress: n });
  }
}
function onActualStart(r: Row, e: Event): void {
  const raw = inputValue(e);
  const v = raw === '' ? null : raw;
  if (v !== r.actualStartDate) patchTask(r, { actualStartDate: v });
}
function onActualEnd(r: Row, e: Event): void {
  const raw = inputValue(e);
  const v = raw === '' ? null : raw;
  if (v !== r.actualEndDate) patchTask(r, { actualEndDate: v });
}
function onPlannedHours(r: Row, e: Event): void {
  const raw = inputValue(e);
  if (raw === '') {
    if (r.plannedHours !== null) patchTask(r, { plannedHours: null });
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n !== r.plannedHours) {
    patchTask(r, { plannedHours: n });
  }
}
function onActualHours(r: Row, e: Event): void {
  const raw = inputValue(e);
  if (raw === '') {
    if (r.actualHours !== null) patchTask(r, { actualHours: null });
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n !== r.actualHours) {
    patchTask(r, { actualHours: n });
  }
}

const today = todayUtc();
const thisMonthStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
const thisMonthEnd = (() => {
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
})();

const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;

// Period filters narrow the list; status filter narrows further. Both client-side
// so the user can flip between them without re-fetching.
const visible = computed<AssignmentRow[]>(() => {
  const period = periodFilter.value;
  return rows.value.filter((r) => {
    if (period === 'this-month') {
      if (!r.startDate || r.startDate < thisMonthStart || r.startDate > thisMonthEnd) return false;
    } else if (period === 'future') {
      if (!r.startDate || r.startDate < todayStr) return false;
    } else if (period === 'in-progress') {
      const s = computeStatus(r, today).bucket;
      if (s !== 'in-progress' && s !== 'overdue' && s !== 'late-start') return false;
    }
    if (statusFilter.value !== null) {
      const s = computeStatus(r, today).bucket;
      if (!statusFilter.value.has(s)) return false;
    }
    if (projectFilter.value !== null && !projectFilter.value.has(r.projectName)) {
      return false;
    }
    const nq = nameFilter.value.trim().toLowerCase();
    if (nq && !(r.name ?? '').toLowerCase().includes(nq)) return false;
    const bq = breadcrumbFilter.value.trim().toLowerCase();
    if (bq) {
      const crumb = `${r.grandparentName ?? ''} ${r.parentName ?? ''}`.toLowerCase();
      if (!crumb.includes(bq)) return false;
    }
    return true;
  });
});

const counts = computed(() => {
  const c = { total: rows.value.length, visible: visible.value.length };
  return c;
});

function statusOf(r: Row) {
  return computeStatus(r, today);
}

function toggleStatusFilter(bucket: StatusBucket): void {
  const cur = statusFilter.value ? new Set(statusFilter.value) : null;
  if (cur === null) {
    statusFilter.value = new Set([bucket]);
  } else if (cur.has(bucket)) {
    cur.delete(bucket);
    statusFilter.value = cur.size === 0 ? null : cur;
  } else {
    cur.add(bucket);
    statusFilter.value = cur;
  }
}

function clearStatusFilter(): void {
  statusFilter.value = null;
}

function openTaskInGantt(r: Row): void {
  router.push({ path: `/projects/${r.projectId}/gantt`, query: { focus: String(r.id) } });
}

function extractMessage(e: unknown): string | null {
  if (typeof e === 'object' && e !== null) {
    const anyE = e as { response?: { data?: { message?: string | string[] } }; message?: string };
    const m = anyE.response?.data?.message;
    if (Array.isArray(m)) return m.join(' / ');
    if (typeof m === 'string') return m;
    if (typeof anyE.message === 'string') return anyE.message;
  }
  return null;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  // YYYY-MM-DD → M/D
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}

function fmtFullDate(d: string | null): string {
  return d ?? '—';
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>担当別予定</h1>
      <div class="controls">
        <label class="select-label">
          <span>社員</span>
          <select v-model.number="selectedId">
            <option v-for="e in employees.activeItems" :key="e.id" :value="e.id">
              {{ e.code ? `${e.code} ` : '' }}{{ e.name }}
              <span v-if="e.department"> / {{ e.department }}</span>
            </option>
          </select>
        </label>
        <div class="period-tabs">
          <button
            v-for="opt in [
              { v: 'all', l: '全件' },
              { v: 'in-progress', l: '進行中のみ' },
              { v: 'this-month', l: '今月開始' },
              { v: 'future', l: '今日以降' },
            ]"
            :key="opt.v"
            class="btn pill"
            :class="{ active: periodFilter === opt.v }"
            type="button"
            @click="periodFilter = opt.v as typeof periodFilter"
          >
            {{ opt.l }}
          </button>
        </div>
        <button
          class="btn add-personal"
          type="button"
          :disabled="selectedId === null || saving"
          title="この社員の個人タスクを追加（プロジェクトのガントには表示されません）"
          @click="addPersonalTask"
        >＋ 個人タスク</button>
      </div>
    </header>

    <section class="status-chips">
      <span class="chip-label">状態:</span>
      <button
        v-for="b in STATUS_BUCKETS"
        :key="b.bucket"
        class="status-chip"
        :class="['st-' + b.bucket, { active: statusFilter?.has(b.bucket) }]"
        type="button"
        @click="toggleStatusFilter(b.bucket)"
      >
        {{ b.label }}
      </button>
      <button
        v-if="statusFilter !== null"
        class="btn small"
        type="button"
        @click="clearStatusFilter"
      >状態クリア</button>
      <span class="spacer"></span>
      <span class="counts">表示 {{ counts.visible }} / 全 {{ counts.total }} 件</span>
    </section>

    <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    <p v-if="loading" class="muted">読込中…</p>
    <p v-else-if="selectedId === null" class="muted">社員を選択してください。</p>
    <p v-else-if="rows.length === 0" class="muted">割当タスクはありません。</p>
    <p v-else-if="visible.length === 0" class="muted">条件に一致するタスクがありません。</p>

    <div v-else class="table-scroll">
    <table class="assign-table">
      <thead>
        <tr>
          <th class="col-project">
            <div class="th-filter">
              <span>プロジェクト</span>
              <button
                class="filter-trigger"
                :class="{ active: isFilterActive('project') }"
                type="button"
                :title="isFilterActive('project') ? 'プロジェクト（絞込中）' : 'プロジェクトで絞込'"
                @click.stop="toggleFilter('project')"
              >▾</button>
              <ColumnFilter
                :open="openFilter === 'project'"
                type="enum"
                title="プロジェクトで絞込"
                :options="projectOptions"
                :selected="projectFilter"
                @close="closeFilter"
                @update-enum="setProjectFilter"
              />
            </div>
          </th>
          <th class="col-breadcrumb">
            <div class="th-filter">
              <span>大項目 ＞ 中項目</span>
              <button
                class="filter-trigger"
                :class="{ active: isFilterActive('breadcrumb') }"
                type="button"
                :title="isFilterActive('breadcrumb') ? '大中項目（絞込中）' : '大中項目で検索'"
                @click.stop="toggleFilter('breadcrumb')"
              >▾</button>
              <ColumnFilter
                :open="openFilter === 'breadcrumb'"
                type="text"
                title="大項目・中項目で検索"
                :text="breadcrumbFilter"
                text-placeholder="部分一致で検索"
                @close="closeFilter"
                @update-text="(v) => (breadcrumbFilter = v)"
              />
            </div>
          </th>
          <th class="col-name">
            <div class="th-filter">
              <span>項目名</span>
              <button
                class="filter-trigger"
                :class="{ active: isFilterActive('name') }"
                type="button"
                :title="isFilterActive('name') ? '項目名（絞込中）' : '項目名で検索'"
                @click.stop="toggleFilter('name')"
              >▾</button>
              <ColumnFilter
                :open="openFilter === 'name'"
                type="text"
                title="項目名で検索"
                :text="nameFilter"
                text-placeholder="部分一致で検索"
                @close="closeFilter"
                @update-text="(v) => (nameFilter = v)"
              />
            </div>
          </th>
          <th class="col-date">開始日</th>
          <th class="col-end">終了日</th>
          <th class="col-num">日数</th>
          <th class="col-hrs">予定工数</th>
          <th class="col-date">実績開始</th>
          <th class="col-date">実績終了</th>
          <th class="col-hrs">実績工数</th>
          <th class="col-progress">進捗</th>
          <th class="col-status">
            <div class="th-filter">
              <span>状態</span>
              <button
                class="filter-trigger"
                :class="{ active: isFilterActive('status') }"
                type="button"
                :title="isFilterActive('status') ? '状態（絞込中）' : '状態で絞込'"
                @click.stop="toggleFilter('status')"
              >▾</button>
              <ColumnFilter
                :open="openFilter === 'status'"
                type="enum"
                title="状態で絞込"
                :options="statusOptions"
                :selected="statusFilter as Set<FilterValue> | null"
                @close="closeFilter"
                @update-enum="setStatusColFilter"
              />
            </div>
          </th>
          <th class="col-ops"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in visible"
          :key="r.kind + '-' + r.id"
          :class="{ 'personal-row': r.kind === 'personal' }"
        >
          <td class="col-project">
            <select
              v-if="r.kind === 'personal'"
              class="proj-select"
              :value="r.projectId || ''"
              :disabled="saving"
              title="個人タスクの紐づけプロジェクト（任意）"
              @change="onProjectChange(r, $event)"
            >
              <option value="">（個人・PJなし）</option>
              <option v-for="p in projects.items" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
            <span v-else class="project-pill">{{ r.projectName }}</span>
          </td>
          <td class="col-breadcrumb">
            <span v-if="r.grandparentName" class="breadcrumb-seg">{{ r.grandparentName }}</span>
            <span v-if="r.grandparentName && r.parentName" class="breadcrumb-sep">＞</span>
            <span v-if="r.parentName" class="breadcrumb-seg muted-seg">{{ r.parentName }}</span>
          </td>
          <td class="col-name">
            <input
              v-if="r.level === 3"
              type="text"
              :value="r.name"
              :disabled="saving"
              placeholder="（名称未入力）"
              @change="onName(r, $event)"
            />
            <span v-else>{{ r.name || '（名称未入力）' }}</span>
          </td>
          <td class="col-date">
            <input
              v-if="r.level === 3"
              type="date"
              :value="r.startDate ?? ''"
              :disabled="saving"
              @change="onStart(r, $event)"
            />
            <span v-else :title="fmtFullDate(r.startDate)">{{ fmtDate(r.startDate) }}</span>
          </td>
          <td class="col-end readonly-cell" :title="fmtFullDate(r.endDate)">
            {{ fmtDate(r.endDate) }}
          </td>
          <td class="col-num">
            <input
              v-if="r.level === 3"
              type="number"
              min="1"
              :value="r.duration ?? ''"
              :disabled="saving"
              @change="onDuration(r, $event)"
            />
            <span v-else>{{ r.duration ?? '' }}</span>
          </td>
          <td class="col-hrs">
            <input
              v-if="r.level === 3"
              type="number"
              min="0"
              step="0.5"
              :value="r.plannedHours ?? ''"
              :disabled="saving"
              @change="onPlannedHours(r, $event)"
            />
            <span v-else>{{ r.plannedHours ?? '' }}</span>
          </td>
          <td class="col-date">
            <input
              v-if="r.level === 3"
              type="date"
              :value="r.actualStartDate ?? ''"
              :disabled="saving"
              @change="onActualStart(r, $event)"
            />
            <span v-else :title="fmtFullDate(r.actualStartDate)">{{ fmtDate(r.actualStartDate) }}</span>
          </td>
          <td class="col-date">
            <input
              v-if="r.level === 3"
              type="date"
              :value="r.actualEndDate ?? ''"
              :disabled="saving"
              @change="onActualEnd(r, $event)"
            />
            <span v-else :title="fmtFullDate(r.actualEndDate)">{{ fmtDate(r.actualEndDate) }}</span>
          </td>
          <td class="col-hrs">
            <input
              v-if="r.level === 3"
              type="number"
              min="0"
              step="0.5"
              :value="r.actualHours ?? ''"
              :disabled="saving"
              @change="onActualHours(r, $event)"
            />
            <span v-else>{{ r.actualHours ?? '' }}</span>
          </td>
          <td class="col-progress">
            <input
              v-if="r.level === 3"
              type="number"
              min="0"
              max="100"
              :value="r.progress"
              :disabled="saving"
              @change="onProgress(r, $event)"
            />
            <div v-else class="progress-bar">
              <div class="progress-fill" :style="{ width: r.progress + '%' }"></div>
              <span class="progress-text">{{ r.progress }}%</span>
            </div>
          </td>
          <td class="col-status">
            <span
              :class="['status-badge', 'st-' + statusOf(r).bucket]"
              :title="statusOf(r).extended || statusOf(r).label"
            >
              <span class="status-label">{{ statusOf(r).label }}</span>
              <span v-if="statusOf(r).extended" class="status-ext">{{ statusOf(r).extended }}</span>
            </span>
          </td>
          <td class="col-ops">
            <div class="ops-wrap">
              <button
                v-if="r.level === 3"
                class="btn small note-btn"
                :class="{ 'has-note': !!(r.note && r.note.trim()) }"
                type="button"
                :title="r.note && r.note.trim() ? '備考を編集（登録済み）' : '備考を追加'"
                @click="openNote(r)"
              >
                備考<span
                  v-if="r.note && r.note.trim()"
                  class="note-dot"
                  aria-hidden="true"
                ></span>
              </button>
              <button
                v-if="r.kind === 'wbs'"
                class="btn small"
                type="button"
                :title="`${r.projectName} の ${r.name} をガントで開く`"
                @click="openTaskInGantt(r)"
              >開く</button>
              <button
                v-else
                class="btn small danger"
                type="button"
                title="この個人タスクを削除"
                @click="removePersonalTask(r)"
              >削除</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    </div>

    <TaskNoteDialog
      :open="noteRow !== null"
      :task-name="noteRow?.name ?? ''"
      :note="noteRow?.note ?? null"
      @close="noteRow = null"
      @save="onSaveNote"
    />
  </div>
</template>

<style scoped>
.page {
  max-width: 1600px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.8rem;
  flex-wrap: wrap;
}
.page-header h1 {
  margin: 0;
  font-size: 1.2rem;
}
.controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.select-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
}
.select-label select {
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
  min-width: 260px;
}
.period-tabs {
  display: inline-flex;
  gap: 0.3rem;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn:hover {
  background: #f9fafb;
}
.btn.small {
  padding: 0.18rem 0.5rem;
  font-size: 0.78rem;
}
.btn.danger {
  color: #b91c1c;
  border-color: #fca5a5;
}
.btn.danger:hover {
  background: #fef2f2;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.add-personal {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eef4ff;
  font-weight: 600;
}
.add-personal:hover {
  background: #e0eaff;
}
.btn.pill {
  border-radius: 12px;
}
.btn.pill.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.status-chips {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.45rem 0.7rem;
  margin-bottom: 0.8rem;
  font-size: 0.85rem;
  flex-wrap: wrap;
}
.chip-label {
  color: #6b7280;
  margin-right: 0.2rem;
}
.status-chip {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 12px;
  padding: 0.18rem 0.65rem;
  cursor: pointer;
  font-size: 0.8rem;
  color: #4b5563;
}
.status-chip:hover {
  border-color: #9ca3af;
}
.status-chip.active {
  font-weight: 600;
}
.status-chip.st-completed.active { background:#ecfdf5; border-color:#34d399; color:#047857; }
.status-chip.st-in-progress.active { background:#dbeafe; border-color:#60a5fa; color:#1e40af; }
.status-chip.st-overdue.active { background:#fee2e2; border-color:#f87171; color:#b91c1c; }
.status-chip.st-late-start.active { background:#fef3c7; border-color:#fbbf24; color:#92400e; }
.status-chip.st-not-started.active { background:#f3f4f6; border-color:#9ca3af; color:#4b5563; }
.spacer {
  flex: 1;
}
.counts {
  color: #6b7280;
  font-size: 0.85rem;
}
.table-scroll {
  overflow-x: auto;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}
.assign-table {
  width: 100%;
  /* No min-width: fixed layout fits all columns into the page width so no
     horizontal scrollbar appears. */
  table-layout: fixed;
  border-collapse: collapse;
  background: #fff;
  font-size: 0.88rem;
}
.assign-table th,
.assign-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.assign-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: visible;
}
.th-filter {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}
.filter-trigger {
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 0.7rem;
  cursor: pointer;
  padding: 1px 4px;
  border-radius: 3px;
  line-height: 1;
}
.filter-trigger:hover {
  background: #e5e7eb;
  color: #374151;
}
.filter-trigger.active {
  background: #2563eb;
  color: #fff;
}
.assign-table tbody tr:hover td {
  background: #f8fafc;
}
.assign-table input {
  width: 100%;
  font: inherit;
  font-size: 0.84rem;
  padding: 0.2rem 0.35rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
}
.assign-table input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}
.assign-table input[type='number'] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.assign-table input:disabled {
  background: #f3f4f6;
  color: #9ca3af;
}
.readonly-cell {
  color: #6b7280;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.col-date {
  width: 122px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #1f2937;
}
/* 終了日 is read-only M/D text — no need for the wide date-input width. */
.col-end {
  width: 58px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #1f2937;
}
.col-num {
  width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.col-hrs {
  width: 66px;
}
.col-ops {
  width: 116px;
  white-space: nowrap;
}
.ops-wrap {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 0.3rem;
}
.col-ops button {
  white-space: nowrap;
}
.note-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}
.note-btn.has-note {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eef4ff;
}
.note-dot {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background: #2563eb;
}
.col-project {
  width: 140px;
}
.project-pill {
  display: inline-block;
  background: #eef2ff;
  color: #3730a3;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-weight: 500;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proj-select {
  width: 100%;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.18rem 0.3rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fffdf5;
}
.personal-row td {
  background: #fffdf5;
}
.col-breadcrumb {
  width: 150px;
  color: #6b7280;
  font-size: 0.82rem;
}
.breadcrumb-seg {
  display: inline-block;
}
.breadcrumb-sep {
  margin: 0 0.25rem;
  color: #d1d5db;
}
.muted-seg {
  color: #9ca3af;
}
.col-name {
  width: 200px;
  font-weight: 600;
  color: #1f2937;
}
.col-progress {
  width: 64px;
}
.progress-bar {
  position: relative;
  height: 16px;
  background: #f1f5f9;
  border-radius: 8px;
  overflow: hidden;
}
.progress-fill {
  background: #34d399;
  height: 100%;
}
.progress-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
}
.col-status {
  width: 128px;
  white-space: nowrap;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.1rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.status-badge.st-completed { background:#ecfdf5; color:#047857; }
.status-badge.st-in-progress { background:#dbeafe; color:#1e40af; }
.status-badge.st-overdue { background:#fee2e2; color:#b91c1c; }
.status-badge.st-late-start { background:#fef3c7; color:#92400e; }
.status-badge.st-not-started { background:#f3f4f6; color:#4b5563; }
.status-label {
  white-space: nowrap;
}
.status-ext {
  color: inherit;
  opacity: 0.75;
  font-weight: 500;
  font-size: 0.72rem;
  white-space: nowrap;
}
.muted {
  color: #94a3b8;
  font-size: 0.9rem;
}
.error {
  color: #dc2626;
  background: #fef2f2;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  font-size: 0.88rem;
  margin: 0 0 0.7rem;
}
</style>
