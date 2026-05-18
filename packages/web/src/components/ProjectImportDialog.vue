<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useCustomersStore } from '@/stores/customers';
import { useEmployeesStore } from '@/stores/employees';
import type { Customer, Employee } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const router = useRouter();
const customers = useCustomersStore();
const employees = useEmployeesStore();

type Step = 'upload' | 'review';
const step = ref<Step>('upload');

// Step 1 state
const customerId = ref<number | null>(null);
const projectName = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const errorMessage = ref<string | null>(null);

// Step 2 state (preview response + user choices)
interface ParsedTask {
  index: number;
  level: 1 | 2 | 3;
  parentIndex: number | null;
  name: string;
  startDate: string | null;
  duration: number | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualHours: number | null;
  progress: number;
  status: string;
  assigneeName: string | null;
}
interface AssigneeMatch {
  name: string;
  suggestedEmployeeId: number | null;
  employmentStart: string | null;
  employmentEnd: string | null;
  worksOnHolidays: boolean;
}
const parsedSchedule = ref<ParsedTask[]>([]);
const matches = ref<AssigneeMatch[]>([]);

// User choices keyed by assignee name from Excel.
interface Choice {
  action: 'link' | 'create' | 'skip';
  employeeId: number | null;
  newCode: string;
  newDepartment: string;
}
const choices = ref<Record<string, Choice>>({});

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    step.value = 'upload';
    customerId.value = null;
    projectName.value = '';
    selectedFile.value = null;
    if (fileInputRef.value) fileInputRef.value.value = '';
    parsedSchedule.value = [];
    matches.value = [];
    choices.value = {};
    errorMessage.value = null;
    uploading.value = false;
    customers.fetchAll();
    employees.fetchAll();
  },
);

function onFileChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  selectedFile.value = target.files && target.files[0] ? target.files[0] : null;
}

async function onPreview(): Promise<void> {
  errorMessage.value = null;
  if (!projectName.value.trim()) {
    errorMessage.value = 'プロジェクト名を入力してください';
    return;
  }
  if (!selectedFile.value) {
    errorMessage.value = 'Excel ファイルを選択してください';
    return;
  }
  uploading.value = true;
  try {
    const form = new FormData();
    form.append('file', selectedFile.value);
    const res = await api.post<{
      schedule: ParsedTask[];
      matches: AssigneeMatch[];
    }>('/projects/import/preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    parsedSchedule.value = res.data.schedule;
    matches.value = res.data.matches;
    // Initialise choices from suggestions: if matched, link; else create.
    const init: Record<string, Choice> = {};
    for (const m of res.data.matches) {
      init[m.name] = {
        action: m.suggestedEmployeeId !== null ? 'link' : 'create',
        employeeId: m.suggestedEmployeeId,
        newCode: '',
        newDepartment: '',
      };
    }
    choices.value = init;
    step.value = 'review';
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? 'プレビューに失敗しました';
  } finally {
    uploading.value = false;
  }
}

async function onCommit(): Promise<void> {
  errorMessage.value = null;
  // Validate "create" choices have at least a name (the Excel name)
  for (const m of matches.value) {
    const c = choices.value[m.name];
    if (c.action === 'link' && c.employeeId === null) {
      errorMessage.value = `「${m.name}」の紐付け先社員を選択してください`;
      return;
    }
  }
  uploading.value = true;
  try {
    const assigneeResolution = matches.value.map((m) => {
      const c = choices.value[m.name];
      if (c.action === 'link') {
        return { name: m.name, action: 'link' as const, employeeId: c.employeeId! };
      }
      if (c.action === 'skip') {
        return { name: m.name, action: 'skip' as const };
      }
      return {
        name: m.name,
        action: 'create' as const,
        newEmployee: {
          code: c.newCode.trim() || null,
          name: m.name,
          department: c.newDepartment.trim() || null,
          employmentStart: m.employmentStart,
          employmentEnd: m.employmentEnd,
          worksOnHolidays: m.worksOnHolidays,
        },
      };
    });
    const res = await api.post<{ projectId: number }>('/projects/import/commit', {
      customerId: customerId.value,
      projectName: projectName.value.trim(),
      schedule: parsedSchedule.value,
      assigneeResolution,
    });
    emit('close');
    router.push({ name: 'gantt', params: { projectId: res.data.projectId } });
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '取込に失敗しました';
  } finally {
    uploading.value = false;
  }
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

const summary = computed(() => {
  const counts = { major: 0, middle: 0, leaf: 0 };
  for (const t of parsedSchedule.value) {
    if (t.level === 1) counts.major += 1;
    else if (t.level === 2) counts.middle += 1;
    else counts.leaf += 1;
  }
  return counts;
});

const allChoicesValid = computed(() => {
  for (const m of matches.value) {
    const c = choices.value[m.name];
    if (!c) return false;
    if (c.action === 'link' && c.employeeId === null) return false;
  }
  return true;
});

// Active employees sorted for the link dropdown.
const employeeOptions = computed<Employee[]>(() => employees.activeItems);
const customerOptions = computed<Customer[]>(() => customers.activeItems);
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" aria-label="Excel 取込">
      <header class="modal-header">
        <h2>Excel 取込で新規プロジェクト作成</h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>

      <!-- Step 1: upload -->
      <form v-if="step === 'upload'" class="modal-body" @submit.prevent="onPreview">
        <p class="muted">
          Excel ファイル（旧テンプレ形式の .xls）からタスクと担当者を取込みます。<br>
          顧客とプロジェクト名はこの画面で指定します。
        </p>
        <label class="row-field">
          <span>顧客</span>
          <select v-model.number="customerId">
            <option :value="null">（顧客未指定）</option>
            <option v-for="c in customerOptions" :key="c.id" :value="c.id">
              {{ c.code ? `[${c.code}] ` : '' }}{{ c.name }}
            </option>
          </select>
        </label>
        <label class="row-field">
          <span>プロジェクト名 <em>*</em></span>
          <input v-model="projectName" type="text" maxlength="200" required />
        </label>
        <label class="row-field">
          <span>Excel ファイル <em>*</em></span>
          <input ref="fileInputRef" type="file" accept=".xls" @change="onFileChange" />
        </label>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" @click="emit('close')">キャンセル</button>
          <button class="btn primary" type="submit" :disabled="uploading">
            {{ uploading ? '読込中…' : 'プレビュー' }}
          </button>
        </footer>
      </form>

      <!-- Step 2: review + reconciliation -->
      <div v-else class="modal-body">
        <section class="summary">
          <strong>取込内容のサマリ</strong>
          <div class="muted">
            大項目 {{ summary.major }} 件 / 中項目 {{ summary.middle }} 件 / 項目 {{ summary.leaf }} 件
          </div>
        </section>
        <section class="match-section">
          <strong>担当者の名寄せ ({{ matches.length }} 名)</strong>
          <p class="muted">
            Excel に書かれている担当者名を、社員マスタの既存社員に紐付けるか、新規登録するかを選択してください。
          </p>
          <table class="match-table">
            <thead>
              <tr>
                <th>Excel 上の名前</th>
                <th>アクション</th>
                <th>選択 / 新規入力</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in matches" :key="m.name">
                <td>
                  <span class="excel-name">{{ m.name }}</span>
                  <span v-if="m.suggestedEmployeeId !== null" class="badge match">既存マッチ</span>
                  <span v-else class="badge new">未登録</span>
                </td>
                <td>
                  <label class="radio">
                    <input
                      v-model="choices[m.name].action"
                      type="radio"
                      :value="'link'"
                    />
                    既存に紐付け
                  </label>
                  <label class="radio">
                    <input
                      v-model="choices[m.name].action"
                      type="radio"
                      :value="'create'"
                    />
                    新規登録
                  </label>
                  <label class="radio">
                    <input
                      v-model="choices[m.name].action"
                      type="radio"
                      :value="'skip'"
                    />
                    未割当のまま
                  </label>
                </td>
                <td>
                  <select
                    v-if="choices[m.name].action === 'link'"
                    v-model.number="choices[m.name].employeeId"
                    class="link-select"
                  >
                    <option :value="null">（社員を選択）</option>
                    <option v-for="e in employeeOptions" :key="e.id" :value="e.id">
                      {{ e.code ? `[${e.code}] ` : '' }}{{ e.name }}
                      <template v-if="e.department"> / {{ e.department }}</template>
                    </option>
                  </select>
                  <div v-else-if="choices[m.name].action === 'create'" class="new-emp">
                    <input
                      v-model="choices[m.name].newCode"
                      type="text"
                      placeholder="社員コード (空欄で自動採番)"
                      maxlength="32"
                    />
                    <input
                      v-model="choices[m.name].newDepartment"
                      type="text"
                      placeholder="所属 (任意)"
                      maxlength="100"
                    />
                  </div>
                  <span v-else class="muted small">担当 null として取込</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" :disabled="uploading" @click="step = 'upload'">戻る</button>
          <button class="btn" type="button" :disabled="uploading" @click="emit('close')">キャンセル</button>
          <button
            class="btn primary"
            type="button"
            :disabled="uploading || !allChoicesValid"
            @click="onCommit"
          >
            {{ uploading ? '取込中…' : '取込実行' }}
          </button>
        </footer>
      </div>
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
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  width: min(860px, 95vw);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}
.modal-header h2 { margin: 0; font-size: 1.05rem; }
.icon-btn {
  border: none; background: none; font-size: 1.4rem;
  cursor: pointer; color: #6b7280;
}
.modal-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  overflow-y: auto;
}
.row-field {
  display: grid;
  grid-template-columns: 9rem 1fr;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.row-field em { color: #dc2626; font-style: normal; }
.row-field input,
.row-field select {
  padding: 0.35rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.summary {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 0.5rem 0.7rem;
  font-size: 0.88rem;
}
.match-section strong { font-size: 0.95rem; }
.muted { color: #6b7280; font-size: 0.85rem; }
.muted.small { font-size: 0.78rem; }
.match-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.match-table th,
.match-table td {
  border-bottom: 1px solid #f1f5f9;
  padding: 0.4rem 0.5rem;
  text-align: left;
  vertical-align: top;
}
.match-table th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  font-size: 0.8rem;
}
.excel-name {
  font-weight: 600;
  margin-right: 0.3rem;
}
.badge {
  display: inline-block;
  font-size: 0.7rem;
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-weight: 500;
}
.badge.match { background: #ecfdf5; color: #047857; }
.badge.new { background: #fef3c7; color: #92400e; }
.radio {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  margin-right: 0.6rem;
  font-size: 0.83rem;
}
.link-select {
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.new-emp {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.new-emp input {
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font: inherit;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #f3f4f6;
  margin-top: 0.5rem;
}
.btn {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 4px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.88rem;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn:hover:not(:disabled) { background: #f9fafb; }
.btn.primary:hover:not(:disabled) { background: #1d4ed8; }
.error {
  color: #dc2626;
  background: #fef2f2;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  font-size: 0.85rem;
  margin: 0;
}
</style>
