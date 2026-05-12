<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useEmployeesStore } from '@/stores/employees';
import { computeStatus, STATUS_BUCKETS, type StatusBucket, todayUtc } from '@/utils/status';
import type { AssignmentRow } from '@/types';

const router = useRouter();
const employees = useEmployeesStore();

const selectedId = ref<number | null>(null);
const periodFilter = ref<'all' | 'in-progress' | 'this-month' | 'future'>('all');
const statusFilter = ref<Set<StatusBucket> | null>(null);
const rows = ref<AssignmentRow[]>([]);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  await employees.fetchAll();
  if (selectedId.value === null && employees.activeItems.length > 0) {
    selectedId.value = employees.activeItems[0].id;
  }
});

watch(selectedId, async (id) => {
  if (id === null) {
    rows.value = [];
    return;
  }
  loading.value = true;
  errorMessage.value = null;
  try {
    const res = await api.get<AssignmentRow[]>(`/employees/${id}/tasks`);
    rows.value = res.data;
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '読み込みに失敗しました';
    rows.value = [];
  } finally {
    loading.value = false;
  }
});

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
    return true;
  });
});

const counts = computed(() => {
  const c = { total: rows.value.length, visible: visible.value.length };
  return c;
});

function statusOf(r: AssignmentRow) {
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

function openTaskInGantt(r: AssignmentRow): void {
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

    <table v-else class="assign-table">
      <thead>
        <tr>
          <th class="col-date">開始日</th>
          <th class="col-date">終了日</th>
          <th class="col-num">日数</th>
          <th class="col-project">プロジェクト</th>
          <th class="col-breadcrumb">大項目 ＞ 中項目</th>
          <th class="col-name">項目名</th>
          <th class="col-progress">進捗</th>
          <th class="col-status">状態</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in visible"
          :key="r.id"
          class="row-clickable"
          :title="`${r.projectName} の ${r.name} を開く`"
          @click="openTaskInGantt(r)"
        >
          <td class="col-date" :title="fmtFullDate(r.startDate)">{{ fmtDate(r.startDate) }}</td>
          <td class="col-date" :title="fmtFullDate(r.endDate)">{{ fmtDate(r.endDate) }}</td>
          <td class="col-num">{{ r.duration ?? '' }}</td>
          <td class="col-project">
            <span class="project-pill">{{ r.projectName }}</span>
          </td>
          <td class="col-breadcrumb">
            <span v-if="r.grandparentName" class="breadcrumb-seg">{{ r.grandparentName }}</span>
            <span v-if="r.grandparentName && r.parentName" class="breadcrumb-sep">＞</span>
            <span v-if="r.parentName" class="breadcrumb-seg muted-seg">{{ r.parentName }}</span>
          </td>
          <td class="col-name">{{ r.name || '（名称未入力）' }}</td>
          <td class="col-progress">
            <div class="progress-bar">
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
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.page {
  max-width: 1280px;
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
.assign-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
  font-size: 0.88rem;
}
.assign-table th,
.assign-table td {
  padding: 0.45rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}
.assign-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  font-size: 0.82rem;
}
.assign-table .row-clickable {
  cursor: pointer;
}
.assign-table .row-clickable:hover td {
  background: #f8fafc;
}
.col-date {
  width: 64px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: #1f2937;
}
.col-num {
  width: 44px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.col-project {
  width: 180px;
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
.col-breadcrumb {
  width: 220px;
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
  font-weight: 600;
  color: #1f2937;
}
.col-progress {
  width: 110px;
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
  width: 150px;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.1rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
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
