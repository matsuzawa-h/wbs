<script setup lang="ts">
import { computed, reactive, ref, watch, nextTick } from 'vue';

// Editable shape — the page maps its Row onto this so the dialog stays
// decoupled from AssignmentRow / personal-task types.
export interface EditTask {
  id: number;
  kind: 'wbs' | 'personal';
  name: string;
  projectId: number | null;
  projectName: string;
  startDate: string | null;
  duration: number | null;
  endDate: string | null;
  plannedHours: number | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualHours: number | null;
  progress: number;
  note: string | null;
  statusLabel: string;
}

const props = defineProps<{
  open: boolean;
  task: EditTask | null;
  projects: { id: number; name: string }[];
  /** Create mode: nothing is persisted until 作成 is pressed. */
  isNew?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', patch: Record<string, unknown>): void;
  (e: 'remove'): void;
  (e: 'open-gantt'): void;
}>();

const dialogLabel = computed(() =>
  props.isNew ? '個人タスクの新規作成' : '予定の編集',
);
const saveLabel = computed(() => (props.isNew ? '作成' : '保存'));

// Form mirror of the editable fields. Strings for inputs; '' = empty.
const form = reactive({
  name: '',
  projectId: '' as string, // '' = 個人・PJなし
  startDate: '',
  duration: '' as string,
  plannedHours: '' as string,
  actualStartDate: '',
  actualEndDate: '',
  actualHours: '' as string,
  progress: '0' as string,
  note: '',
});

const firstRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open || !props.task) return;
    const t = props.task;
    form.name = t.name ?? '';
    form.projectId = t.projectId != null ? String(t.projectId) : '';
    form.startDate = t.startDate ?? '';
    form.duration = t.duration != null ? String(t.duration) : '';
    form.plannedHours = t.plannedHours != null ? String(t.plannedHours) : '';
    form.actualStartDate = t.actualStartDate ?? '';
    form.actualEndDate = t.actualEndDate ?? '';
    form.actualHours = t.actualHours != null ? String(t.actualHours) : '';
    form.progress = String(t.progress ?? 0);
    form.note = t.note ?? '';
    nextTick(() => firstRef.value?.focus());
  },
  { immediate: true },
);

// Vue 3 coerces `<input type="number">` v-model to a number (even without
// the .number modifier), so accept number | string | null here.
function numOrNull(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const str = String(s).trim();
  if (str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

// Build a patch of ONLY changed fields (so we don't clobber unrelated
// values or trigger needless cascade recompute).
function buildPatch(): Record<string, unknown> {
  const t = props.task!;
  const p: Record<string, unknown> = {};

  if (form.name !== (t.name ?? '')) p.name = form.name;

  if (t.kind === 'personal') {
    const pid = form.projectId === '' ? null : Number(form.projectId);
    if (pid !== (t.projectId ?? null)) p.projectId = pid;
  }

  if (form.startDate && form.startDate !== (t.startDate ?? '')) {
    p.startDate = form.startDate;
  }

  const dur = numOrNull(form.duration);
  if (dur !== null && dur > 0 && dur !== t.duration) p.duration = dur;

  const ph = numOrNull(form.plannedHours);
  if (ph !== (t.plannedHours ?? null) && (ph === null || ph >= 0)) {
    p.plannedHours = ph;
  }

  const as = form.actualStartDate === '' ? null : form.actualStartDate;
  if (as !== (t.actualStartDate ?? null)) p.actualStartDate = as;

  const ae = form.actualEndDate === '' ? null : form.actualEndDate;
  if (ae !== (t.actualEndDate ?? null)) p.actualEndDate = ae;

  const ah = numOrNull(form.actualHours);
  if (ah !== (t.actualHours ?? null) && (ah === null || ah >= 0)) {
    p.actualHours = ah;
  }

  const pr = numOrNull(form.progress);
  if (pr !== null && pr >= 0 && pr <= 100 && pr !== t.progress) {
    p.progress = pr;
  }

  const note = form.note.trim();
  const noteVal = note === '' ? null : note;
  if (noteVal !== (t.note ?? null)) p.note = noteVal;

  return p;
}

function todayStr(): string {
  const n = new Date();
  const d = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 完了: stamp the actual end date with today (the status logic reads this as
// "完了"), set progress to 100%, and persist — pressing 完了 is explicit.
function onComplete(): void {
  form.actualEndDate = todayStr();
  form.progress = '100';
  onSave();
}

function onSave(): void {
  if (!props.task) return;
  const patch = buildPatch();
  // Create mode: always emit so the task is persisted on 作成 (even when
  // nothing was typed). Edit mode: an empty patch means "no changes".
  if (!props.isNew && Object.keys(patch).length === 0) {
    emit('close');
    return;
  }
  emit('save', patch);
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    onSave();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

function fmtMd(d: string | null): string {
  if (!d) return '—';
  const [, m, day] = d.split('-');
  return `${Number(m)}/${Number(day)}`;
}
</script>

<template>
  <div
    v-if="open && task"
    class="modal-backdrop"
    @mousedown.self="emit('close')"
    @keydown="onKeydown"
  >
    <div class="modal" role="dialog" :aria-label="dialogLabel">
      <header class="modal-header">
        <h2>
          {{ dialogLabel }}
          <small>― {{ task.kind === 'personal' ? '個人タスク' : task.projectName }}</small>
        </h2>
        <button class="icon-btn" type="button" aria-label="閉じる" @click="emit('close')">×</button>
      </header>

      <div class="modal-body">
        <div class="grid">
          <label class="fld span2">
            <span>項目名</span>
            <input ref="firstRef" v-model="form.name" type="text" placeholder="（名称未入力）" />
          </label>

          <label v-if="task.kind === 'personal'" class="fld span2">
            <span>プロジェクト（任意）</span>
            <select v-model="form.projectId">
              <option value="">（個人・PJなし）</option>
              <option v-for="p in projects" :key="p.id" :value="String(p.id)">
                {{ p.name }}
              </option>
            </select>
          </label>
          <label v-else class="fld span2">
            <span>プロジェクト</span>
            <input :value="task.projectName" type="text" disabled />
          </label>

          <label class="fld">
            <span>開始日</span>
            <input v-model="form.startDate" type="date" />
          </label>
          <label class="fld">
            <span>日数</span>
            <input v-model="form.duration" type="number" min="1" />
          </label>

          <label class="fld">
            <span>終了日（自動）</span>
            <input :value="fmtMd(task.endDate)" type="text" disabled />
          </label>
          <label class="fld">
            <span>予定工数</span>
            <input v-model="form.plannedHours" type="number" min="0" step="0.5" />
          </label>

          <label class="fld">
            <span>実績開始</span>
            <input v-model="form.actualStartDate" type="date" />
          </label>
          <div class="fld">
            <span>実績終了</span>
            <div class="actualend-row">
              <input v-model="form.actualEndDate" type="date" />
              <button
                class="done-btn"
                type="button"
                title="実績終了日に今日を登録し、進捗を100%にして完了にする"
                @click="onComplete"
              >✓ 完了にする</button>
            </div>
          </div>

          <label class="fld">
            <span>実績工数</span>
            <input v-model="form.actualHours" type="number" min="0" step="0.5" />
          </label>
          <label class="fld">
            <span>進捗 (%)</span>
            <input v-model="form.progress" type="number" min="0" max="100" />
          </label>

          <div class="fld span2 status-row">
            <span>状態</span>
            <strong>{{ task.statusLabel }}</strong>
            <small>（開始日・進捗・実績から自動判定）</small>
          </div>

          <label class="fld span2">
            <span>備考</span>
            <textarea
              v-model="form.note"
              rows="4"
              maxlength="2000"
              placeholder="この項目の備考・メモ（Ctrl+Enter で保存）"
            ></textarea>
          </label>
        </div>
      </div>

      <footer class="modal-footer">
        <button
          v-if="!isNew && task.kind === 'wbs'"
          class="btn"
          type="button"
          title="このタスクをプロジェクトのガントで開く"
          @click="emit('open-gantt')"
        >ガントで開く</button>
        <button
          v-else-if="!isNew"
          class="btn danger"
          type="button"
          title="この個人タスクを削除"
          @click="emit('remove')"
        >削除</button>
        <span class="spacer"></span>
        <button class="btn" type="button" @click="emit('close')">キャンセル</button>
        <button class="btn primary" type="button" @click="onSave">{{ saveLabel }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--c-surface);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  width: min(620px, 94vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--c-border);
}
.modal-header h2 {
  margin: 0;
  font-size: 1.05rem;
}
.modal-header h2 small {
  color: var(--c-text-muted);
  font-weight: 500;
  margin-left: 0.4rem;
  font-size: 0.85rem;
}
.icon-btn {
  border: none;
  background: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: var(--c-text-muted);
  line-height: 1;
}
.modal-body {
  padding: 0.9rem 1rem;
  overflow-y: auto;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem 0.9rem;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}
.fld.span2 {
  grid-column: 1 / -1;
}
.fld > span {
  color: var(--c-text-muted);
  font-size: 0.78rem;
}
.fld input,
.fld select,
.fld textarea {
  font: inherit;
  font-size: 0.88rem;
  padding: 0.35rem 0.45rem;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r);
  background: var(--c-surface);
  color: var(--c-text);
}
.fld textarea {
  resize: vertical;
  line-height: 1.5;
}
.fld input:focus,
.fld select:focus,
.fld textarea:focus {
  outline: none;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-ring);
}
.fld input:disabled {
  background: var(--c-surface-2, #f3f4f6);
  color: var(--c-text-muted);
}
.fld input[type='number'] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.actualend-row {
  display: flex;
  gap: 0.4rem;
  align-items: stretch;
}
.actualend-row input {
  flex: 1;
  min-width: 0;
}
.done-btn {
  flex: none;
  border: 1px solid #059669;
  background: #10b981;
  color: #fff;
  border-radius: var(--r);
  padding: 0.4rem 0.95rem;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  transition: background 0.12s, transform 0.05s;
}
.done-btn:hover {
  background: #059669;
}
.done-btn:active {
  transform: translateY(1px);
}
.status-row {
  flex-direction: row;
  align-items: baseline;
  gap: 0.5rem;
}
.status-row small {
  color: var(--c-text-faint);
  font-size: 0.74rem;
}
.modal-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.7rem 1rem;
  border-top: 1px solid var(--c-border);
}
.spacer {
  flex: 1;
}
.btn {
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
  border-radius: var(--r);
  padding: 0.35rem 0.85rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn:hover {
  background: var(--c-surface-2, #f3f4f6);
}
.btn.primary {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: #fff;
  font-weight: 600;
}
.btn.primary:hover {
  filter: brightness(0.96);
}
.btn.danger {
  color: #b91c1c;
  border-color: #fca5a5;
}
.btn.danger:hover {
  background: #fef2f2;
}
</style>
