<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useEmployeesStore } from '@/stores/employees';
import { useProjectsStore } from '@/stores/projects';
import type { Employee, Project } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'committed'): void }>();

const router = useRouter();
const employees = useEmployeesStore();
const projects = useProjectsStore();

type Step = 'upload' | 'review';
const step = ref<Step>('upload');

const fiscalYear = ref<number>(currentFiscalYear());
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const uploading = ref(false);
const errorMessage = ref<string | null>(null);

interface AssigneeMatch {
  name: string;
  suggestedAssigneeId: number | null;
}
interface ProjectMatch {
  projectKey: string;
  projectCode: string | null;
  sampleName: string;
  customerName: string | null;
  suggestedProjectId: number | null;
  suggestedProjectName: string | null;
}
interface PreviewResult {
  fiscalYear: number;
  orgCode: string | null;
  assigneeMatches: AssigneeMatch[];
  projectMatches: ProjectMatch[];
  entries: unknown[];
  capacities: unknown[];
  summary: {
    entryCount: number;
    capacityCount: number;
    assigneeCount: number;
    projectCount: number;
    totalHours: number;
  };
}
const preview = ref<PreviewResult | null>(null);

interface ACh {
  action: 'link' | 'create' | 'skip';
  assigneeId: number | null;
  newCode: string;
  newDepartment: string;
}
interface PCh {
  action: 'link' | 'createProvisional';
  projectId: number | null;
  provisionalName: string;
}
const aChoices = ref<Record<string, ACh>>({});
const pChoices = ref<Record<string, PCh>>({});

function currentFiscalYear(): number {
  const now = new Date();
  // 4月始まり: 1〜3月は前年度。
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

// ファイル名 _YYYYMMDD_ から年度を推定（無ければ当日基準）。
function guessFiscalYearFromName(name: string): number {
  const m = /_(\d{4})(\d{2})\d{2}_/.exec(name);
  if (!m) return currentFiscalYear();
  const y = Number(m[1]);
  const mon = Number(m[2]);
  return mon >= 4 ? y : y - 1;
}

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    step.value = 'upload';
    fiscalYear.value = currentFiscalYear();
    selectedFile.value = null;
    if (fileInputRef.value) fileInputRef.value.value = '';
    preview.value = null;
    aChoices.value = {};
    pChoices.value = {};
    errorMessage.value = null;
    uploading.value = false;
    employees.fetchAll();
    projects.fetchAll();
  },
);

function onFileChange(e: Event): void {
  const target = e.target as HTMLInputElement;
  const f = target.files && target.files[0] ? target.files[0] : null;
  selectedFile.value = f;
  if (f) fiscalYear.value = guessFiscalYearFromName(f.name);
}

async function onPreview(): Promise<void> {
  errorMessage.value = null;
  if (!selectedFile.value) {
    errorMessage.value = 'CSV ファイルを選択してください';
    return;
  }
  uploading.value = true;
  try {
    const form = new FormData();
    form.append('file', selectedFile.value);
    form.append('fiscalYear', String(fiscalYear.value));
    const res = await api.post<PreviewResult>(
      '/manhours/import/preview',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    preview.value = res.data;
    const a: Record<string, ACh> = {};
    for (const m of res.data.assigneeMatches) {
      a[m.name] = {
        action: m.suggestedAssigneeId !== null ? 'link' : 'create',
        assigneeId: m.suggestedAssigneeId,
        newCode: '',
        newDepartment: '',
      };
    }
    aChoices.value = a;
    const p: Record<string, PCh> = {};
    for (const m of res.data.projectMatches) {
      p[m.projectKey] = {
        action: m.suggestedProjectId !== null ? 'link' : 'createProvisional',
        projectId: m.suggestedProjectId,
        provisionalName: m.sampleName,
      };
    }
    pChoices.value = p;
    step.value = 'review';
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? 'プレビューに失敗しました';
  } finally {
    uploading.value = false;
  }
}

const allValid = computed(() => {
  const pv = preview.value;
  if (!pv) return false;
  for (const m of pv.assigneeMatches) {
    const c = aChoices.value[m.name];
    if (!c) return false;
    if (c.action === 'link' && c.assigneeId === null) return false;
  }
  for (const m of pv.projectMatches) {
    const c = pChoices.value[m.projectKey];
    if (!c) return false;
    if (c.action === 'link' && c.projectId === null) return false;
    if (c.action === 'createProvisional' && !c.provisionalName.trim())
      return false;
  }
  return true;
});

async function onCommit(): Promise<void> {
  const pv = preview.value;
  if (!pv) return;
  errorMessage.value = null;
  uploading.value = true;
  try {
    const assigneeResolution = pv.assigneeMatches.map((m) => {
      const c = aChoices.value[m.name];
      if (c.action === 'link')
        return { name: m.name, action: 'link', assigneeId: c.assigneeId! };
      if (c.action === 'skip') return { name: m.name, action: 'skip' };
      return {
        name: m.name,
        action: 'create',
        newEmployee: {
          code: c.newCode.trim() || null,
          name: m.name,
          department: c.newDepartment.trim() || null,
        },
      };
    });
    const projectResolution = pv.projectMatches.map((m) => {
      const c = pChoices.value[m.projectKey];
      if (c.action === 'link')
        return {
          projectKey: m.projectKey,
          action: 'link',
          projectId: c.projectId!,
        };
      return {
        projectKey: m.projectKey,
        action: 'createProvisional',
        projectCode: m.projectCode,
        provisionalName: c.provisionalName.trim(),
      };
    });
    await api.post('/manhours/import/commit', {
      fileName: selectedFile.value?.name ?? 'manhours.csv',
      fiscalYear: pv.fiscalYear,
      orgCode: pv.orgCode,
      assigneeResolution,
      projectResolution,
      entries: pv.entries,
      capacities: pv.capacities,
    });
    emit('committed');
    emit('close');
    router.push({ name: 'manhours' });
  } catch (e: unknown) {
    errorMessage.value = extractMessage(e) ?? '取込に失敗しました';
  } finally {
    uploading.value = false;
  }
}

function extractMessage(e: unknown): string | null {
  if (typeof e === 'object' && e !== null) {
    const anyE = e as {
      response?: { data?: { message?: string | string[] } };
      message?: string;
    };
    const m = anyE.response?.data?.message;
    if (Array.isArray(m)) return m.join(' / ');
    if (typeof m === 'string') return m;
    if (typeof anyE.message === 'string') return anyE.message;
  }
  return null;
}

const employeeOptions = computed<Employee[]>(() => employees.activeItems);
const projectOptions = computed<Project[]>(() => projects.items);
const fyOptions = computed<number[]>(() => {
  const base = currentFiscalYear();
  return [base + 1, base, base - 1, base - 2];
});
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <div class="modal" role="dialog" aria-label="稼働管理表CSV取込">
      <header class="modal-header">
        <h2>稼働管理表（明細）CSV 取込</h2>
        <button class="icon-btn" type="button" @click="emit('close')" aria-label="閉じる">×</button>
      </header>

      <!-- Step 1: upload -->
      <form v-if="step === 'upload'" class="modal-body" @submit.prevent="onPreview">
        <p class="muted">
          別システムから出力した Shift-JIS の CSV を取込みます。<br />
          毎回新規バッチとして取り込まれ、過去の取込は履歴として残ります。
        </p>
        <label class="row-field">
          <span>対象年度</span>
          <select v-model.number="fiscalYear">
            <option v-for="y in fyOptions" :key="y" :value="y">{{ y }} 年度（{{ y }}-04 〜 {{ y + 1 }}-03）</option>
          </select>
        </label>
        <label class="row-field">
          <span>CSV ファイル <em>*</em></span>
          <input ref="fileInputRef" type="file" accept=".csv" @change="onFileChange" />
        </label>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" @click="emit('close')">キャンセル</button>
          <button class="btn primary" type="submit" :disabled="uploading">
            {{ uploading ? '読込中…' : 'プレビュー' }}
          </button>
        </footer>
      </form>

      <!-- Step 2: review -->
      <div v-else-if="preview" class="modal-body">
        <section class="summary">
          <strong>取込内容のサマリ（{{ preview.fiscalYear }} 年度）</strong>
          <div class="muted">
            明細 {{ preview.summary.entryCount }} 件 / 月基準時間 {{ preview.summary.capacityCount }} 件 /
            担当者 {{ preview.summary.assigneeCount }} 名 / 案件 {{ preview.summary.projectCount }} 件 /
            合計 {{ preview.summary.totalHours.toFixed(1) }} h
          </div>
        </section>

        <section class="match-section">
          <strong>担当者の名寄せ（{{ preview.assigneeMatches.length }} 名）</strong>
          <table class="match-table">
            <thead>
              <tr><th>CSV 上の名前</th><th>アクション</th><th>選択 / 新規入力</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in preview.assigneeMatches" :key="m.name">
                <td>
                  <span class="excel-name">{{ m.name }}</span>
                  <span v-if="m.suggestedAssigneeId !== null" class="badge match">既存マッチ</span>
                  <span v-else class="badge new">未登録</span>
                </td>
                <td>
                  <label class="radio"><input v-model="aChoices[m.name].action" type="radio" value="link" />既存に紐付け</label>
                  <label class="radio"><input v-model="aChoices[m.name].action" type="radio" value="create" />新規登録</label>
                  <label class="radio"><input v-model="aChoices[m.name].action" type="radio" value="skip" />取込まない</label>
                </td>
                <td>
                  <select v-if="aChoices[m.name].action === 'link'" v-model.number="aChoices[m.name].assigneeId" class="link-select">
                    <option :value="null">（社員を選択）</option>
                    <option v-for="e in employeeOptions" :key="e.id" :value="e.id">
                      {{ e.code ? `[${e.code}] ` : '' }}{{ e.name }}
                    </option>
                  </select>
                  <div v-else-if="aChoices[m.name].action === 'create'" class="new-emp">
                    <input v-model="aChoices[m.name].newCode" type="text" placeholder="社員コード (空欄で自動)" maxlength="32" />
                    <input v-model="aChoices[m.name].newDepartment" type="text" placeholder="所属 (任意)" maxlength="100" />
                  </div>
                  <span v-else class="muted small">この担当者の行は取込まない</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="match-section">
          <strong>案件（プロジェクトCD）の名寄せ（{{ preview.projectMatches.length }} 件）</strong>
          <p class="muted">CD が既存プロジェクトに一致しない場合は仮プロジェクトを作成します。</p>
          <table class="match-table">
            <thead>
              <tr><th>件名 / CD</th><th>アクション</th><th>選択 / 仮案件名</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in preview.projectMatches" :key="m.projectKey">
                <td>
                  <span class="excel-name">{{ m.sampleName }}</span><br />
                  <span class="muted small">{{ m.projectCode ? `CD: ${m.projectCode}` : 'CD なし' }}</span>
                  <span v-if="m.suggestedProjectId !== null" class="badge match">既存マッチ</span>
                  <span v-else class="badge new">仮作成</span>
                </td>
                <td>
                  <label class="radio"><input v-model="pChoices[m.projectKey].action" type="radio" value="link" />既存に紐付け</label>
                  <label class="radio"><input v-model="pChoices[m.projectKey].action" type="radio" value="createProvisional" />仮プロジェクト作成</label>
                </td>
                <td>
                  <select v-if="pChoices[m.projectKey].action === 'link'" v-model.number="pChoices[m.projectKey].projectId" class="link-select">
                    <option :value="null">（プロジェクトを選択）</option>
                    <option v-for="p in projectOptions" :key="p.id" :value="p.id">
                      {{ p.isProvisional ? '【仮】' : '' }}{{ p.name }}{{ p.projectCode ? ` (${p.projectCode})` : '' }}
                    </option>
                  </select>
                  <input v-else v-model="pChoices[m.projectKey].provisionalName" type="text" class="link-select" maxlength="200" placeholder="仮プロジェクト名" />
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <footer class="modal-footer">
          <button class="btn" type="button" :disabled="uploading" @click="step = 'upload'">戻る</button>
          <button class="btn" type="button" :disabled="uploading" @click="emit('close')">キャンセル</button>
          <button class="btn primary" type="button" :disabled="uploading || !allValid" @click="onCommit">
            {{ uploading ? '取込中…' : '取込実行' }}
          </button>
        </footer>
      </div>
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
  box-shadow: var(--shadow-pop); width: min(900px, 95vw);
  max-height: 92vh; display: flex; flex-direction: column;
}
.modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--c-border);
}
.modal-header h2 { margin: 0; font-size: 1.05rem; }
.icon-btn { border: none; background: none; font-size: 1.4rem; cursor: pointer; color: var(--c-text-muted); }
.modal-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.9rem; overflow-y: auto; }
.row-field {
  display: grid; grid-template-columns: 9rem 1fr; align-items: center;
  gap: 0.5rem; font-size: 0.9rem;
}
.row-field em { color: var(--c-danger-fg); font-style: normal; }
.summary {
  background: var(--c-surface-2); border: 1px solid var(--c-border);
  border-radius: var(--r-sm); padding: 0.5rem 0.7rem; font-size: 0.88rem;
}
.match-section strong { font-size: 0.95rem; }
.muted { color: var(--c-text-muted); font-size: 0.85rem; }
.muted.small { font-size: 0.78rem; }
.match-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.match-table th, .match-table td {
  border-bottom: 1px solid var(--c-border); padding: 0.4rem 0.5rem;
  text-align: left; vertical-align: top;
}
.match-table th { background: var(--c-surface-2); color: var(--c-text-muted); font-weight: 600; font-size: 0.8rem; }
.excel-name { font-weight: 600; margin-right: 0.3rem; }
.badge { display: inline-block; font-size: 0.7rem; padding: 0.05rem 0.4rem; border-radius: 3px; font-weight: 500; margin-left: 0.3rem; }
.badge.match { background: var(--c-ok-bg); color: var(--c-ok-fg); }
.badge.new { background: var(--c-warn-bg); color: var(--c-warn-fg); }
.radio { display: inline-flex; align-items: center; gap: 0.2rem; margin-right: 0.6rem; font-size: 0.83rem; }
.link-select { width: 100%; }
.new-emp { display: flex; flex-direction: column; gap: 0.3rem; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding-top: 0.5rem; border-top: 1px solid var(--c-border); margin-top: 0.5rem;
}
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); font-size: 0.85rem; margin: 0;
}
</style>
