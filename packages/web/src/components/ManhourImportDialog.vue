<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useEmployeesStore } from '@/stores/employees';
import { useProjectsStore } from '@/stores/projects';
import { useCustomersStore } from '@/stores/customers';
import type { Customer, Employee, Project } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'committed'): void }>();

const router = useRouter();
const employees = useEmployeesStore();
const projects = useProjectsStore();
const customers = useCustomersStore();

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
  stem: string;
  suggestedProjectId: number | null;
  suggestedProjectName: string | null;
  proposedGroupKey: string;
  proposedGroupName: string;
}
interface CustomerMatch {
  name: string;
  suggestedCustomerId: number | null;
  suggestedCustomerName: string | null;
}
interface PreviewResult {
  fiscalYear: number;
  orgCode: string | null;
  assigneeMatches: AssigneeMatch[];
  customerMatches: CustomerMatch[];
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
interface CCh {
  action: 'link' | 'create' | 'skip';
  customerId: number | null;
  newCode: string;
}
const aChoices = ref<Record<string, ACh>>({});
const cChoices = ref<Record<string, CCh>>({});
// 案件(CD)ごとの束ね先: 'labelOnly' | `link:<projectId>` | `grp:<groupKey>`
const pBucket = ref<Record<string, string>>({});
// grp:<key> → 新規プロジェクト名（編集可）
const groupNames = ref<Record<string, string>>({});

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
    cChoices.value = {};
    pBucket.value = {};
    groupNames.value = {};
    errorMessage.value = null;
    uploading.value = false;
    employees.fetchAll();
    projects.fetchAll();
    customers.fetchAll();
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
    const c: Record<string, CCh> = {};
    for (const m of res.data.customerMatches) {
      c[m.name] = {
        action: m.suggestedCustomerId !== null ? 'link' : 'create',
        customerId: m.suggestedCustomerId,
        newCode: '',
      };
    }
    cChoices.value = c;
    // 束ね先の既定: 既存一致→link:<id>、CD有り未一致→提案グループ grp:<key>、
    // CD無し→labelOnly。同一 stem の複数CDは同じ grp:<key> に既定で束ねる。
    const pb: Record<string, string> = {};
    const gn: Record<string, string> = {};
    for (const m of res.data.projectMatches) {
      if (m.suggestedProjectId !== null) {
        pb[m.projectKey] = `link:${m.suggestedProjectId}`;
      } else if (m.projectCode) {
        pb[m.projectKey] = m.proposedGroupKey; // grp:<stem>
        if (!(m.proposedGroupKey in gn))
          gn[m.proposedGroupKey] = m.proposedGroupName;
      } else {
        pb[m.projectKey] = 'labelOnly';
      }
    }
    pBucket.value = pb;
    groupNames.value = gn;
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
  for (const m of pv.customerMatches) {
    const c = cChoices.value[m.name];
    if (!c) return false;
    if (c.action === 'link' && c.customerId === null) return false;
  }
  for (const m of pv.projectMatches) {
    const b = pBucket.value[m.projectKey];
    if (!b) return false;
    if (b.startsWith('grp:') && !(groupNames.value[b] ?? '').trim())
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
    const customerResolution = pv.customerMatches.map((m) => {
      const c = cChoices.value[m.name];
      if (c.action === 'link')
        return { name: m.name, action: 'link', customerId: c.customerId! };
      if (c.action === 'skip') return { name: m.name, action: 'skip' };
      return {
        name: m.name,
        action: 'create',
        newCustomer: { name: m.name, code: c.newCode.trim() || null },
      };
    });
    const projectResolution = pv.projectMatches.map((m) => {
      const b = pBucket.value[m.projectKey] ?? 'labelOnly';
      if (b === 'labelOnly')
        return { projectKey: m.projectKey, action: 'labelOnly' };
      if (b.startsWith('link:'))
        return {
          projectKey: m.projectKey,
          action: 'link',
          projectId: Number(b.slice(5)),
          projectCode: m.projectCode,
        };
      // grp:<key> → 同じ key のCDが 1 新規プロジェクトに束ねられる
      return {
        projectKey: m.projectKey,
        action: 'newGroup',
        projectCode: m.projectCode,
        groupKey: b,
        groupName: (groupNames.value[b] ?? m.proposedGroupName).trim(),
        customerName: m.customerName,
      };
    });
    await api.post('/manhours/import/commit', {
      fileName: selectedFile.value?.name ?? 'manhours.csv',
      fiscalYear: pv.fiscalYear,
      orgCode: pv.orgCode,
      assigneeResolution,
      customerResolution,
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
const customerOptions = computed<Customer[]>(() => customers.activeItems);

// 現在 pBucket で使われている新規グループ(grp:*)と、束ねられたCD件数。
const groupBuckets = computed<Array<{ key: string; count: number }>>(() => {
  const counts = new Map<string, number>();
  for (const v of Object.values(pBucket.value)) {
    if (v && v.startsWith('grp:'))
      counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
});
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
          <strong>顧客の名寄せ（{{ preview.customerMatches.length }} 社）</strong>
          <p class="muted">
            CSV「顧客名」(E列) を既存の顧客マスタに紐付けるか、未登録なら新規登録します。
            仮プロジェクト作成時、この結果で案件に顧客が紐づきます。
          </p>
          <table class="match-table">
            <thead>
              <tr><th>CSV 顧客名</th><th>アクション</th><th>選択 / 新規入力</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in preview.customerMatches" :key="m.name">
                <td>
                  <span class="excel-name">{{ m.name }}</span>
                  <span v-if="m.suggestedCustomerId !== null" class="badge match">
                    既存マッチ<template v-if="m.suggestedCustomerName && m.suggestedCustomerName !== m.name"> → {{ m.suggestedCustomerName }}</template>
                  </span>
                  <span v-else class="badge new">未登録</span>
                </td>
                <td>
                  <label class="radio"><input v-model="cChoices[m.name].action" type="radio" value="link" />既存に紐付け</label>
                  <label class="radio"><input v-model="cChoices[m.name].action" type="radio" value="create" />顧客マスタに新規登録</label>
                  <label class="radio"><input v-model="cChoices[m.name].action" type="radio" value="skip" />紐付けない</label>
                </td>
                <td>
                  <select v-if="cChoices[m.name].action === 'link'" v-model.number="cChoices[m.name].customerId" class="link-select">
                    <option :value="null">（顧客を選択）</option>
                    <option v-for="cu in customerOptions" :key="cu.id" :value="cu.id">
                      {{ cu.code ? `[${cu.code}] ` : '' }}{{ cu.name }}
                    </option>
                  </select>
                  <input
                    v-else-if="cChoices[m.name].action === 'create'"
                    v-model="cChoices[m.name].newCode"
                    type="text"
                    class="link-select"
                    placeholder="顧客コード (任意・空欄可)"
                    maxlength="32"
                  />
                  <span v-else class="muted small">顧客を紐付けずに取込</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="match-section">
          <strong>案件（プロジェクトCD）の束ね（{{ preview.projectMatches.length }} 件）</strong>
          <p class="muted">
            <strong>プロジェクト化の対象は作業区分=AFTの行のみ</strong>です（MNT/SY/空/zz は工数のみ計上＝件名ラベル）。<br />
            工程ごとに別CDでも、<strong>同じ「束ね名」のCDは1プロジェクト＝1ガント</strong>に束ねます
            （件名から期間/工程表記を除いて自動提案）。各CDの「束ね先」を変えれば手動で再編成できます。
            既存プロジェクトに紐付けるとそのCDが恒久登録され、次回以降は自動で同じプロジェクトへ。
            CD無しの担当者フリー作業は「ラベルのみ」（マスタ作らず件名で計上）。
          </p>

          <div v-if="groupBuckets.length" class="group-edit">
            <strong class="small">新規グループ（束ねて作成するプロジェクト名・編集可）</strong>
            <div v-for="g in groupBuckets" :key="g.key" class="group-row">
              <input v-model="groupNames[g.key]" type="text" maxlength="200" class="link-select" />
              <span class="muted small">CD {{ g.count }} 件を束ねて 1 プロジェクト</span>
            </div>
          </div>

          <table class="match-table">
            <thead>
              <tr><th>件名 / CD / 束ね名</th><th>束ね先</th></tr>
            </thead>
            <tbody>
              <tr v-for="m in preview.projectMatches" :key="m.projectKey">
                <td>
                  <span class="excel-name">{{ m.sampleName }}</span><br />
                  <span class="muted small">
                    {{ m.projectCode ? `CD: ${m.projectCode}` : 'CD なし' }}
                    <template v-if="m.projectCode"> / 束ね名: {{ m.proposedGroupName }}</template>
                  </span>
                  <span v-if="m.suggestedProjectId !== null" class="badge match">既存マッチ</span>
                  <span v-else-if="m.projectCode" class="badge new">束ね（新規）</span>
                  <span v-else class="badge label">ラベルのみ</span>
                </td>
                <td>
                  <select v-model="pBucket[m.projectKey]" class="link-select">
                    <option value="labelOnly">ラベルのみ（登録しない）</option>
                    <optgroup label="新規グループに束ねる">
                      <option v-for="g in groupBuckets" :key="g.key" :value="g.key">
                        新規: {{ groupNames[g.key] || g.key }}
                      </option>
                    </optgroup>
                    <optgroup label="既存プロジェクトに紐付け">
                      <option
                        v-for="p in projectOptions"
                        :key="p.id"
                        :value="`link:${p.id}`"
                      >
                        {{ p.isProvisional ? '【仮】' : '' }}{{ p.name }}{{ p.projectCode ? ` (${p.projectCode})` : '' }}
                      </option>
                    </optgroup>
                  </select>
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
.badge.label { background: var(--c-neutral-bg); color: var(--c-neutral-fg); }
.radio { display: inline-flex; align-items: center; gap: 0.2rem; margin-right: 0.6rem; font-size: 0.83rem; }
.link-select { width: 100%; }
.new-emp { display: flex; flex-direction: column; gap: 0.3rem; }
.prov-fields { display: flex; flex-direction: column; gap: 0.3rem; }
.modal-footer {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding-top: 0.5rem; border-top: 1px solid var(--c-border); margin-top: 0.5rem;
}
.error {
  color: var(--c-danger-fg); background: var(--c-danger-bg);
  padding: 0.45rem 0.7rem; border-radius: var(--r-sm); font-size: 0.85rem; margin: 0;
}
</style>
