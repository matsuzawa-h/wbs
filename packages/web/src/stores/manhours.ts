import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type {
  AssigneeDetail,
  CapacitySummary,
  ManhourBatch,
  ManualEntryInput,
  Project,
  ProjectMatrix,
} from '@/types';

/**
 * 稼働見通し（月次工数）ストア。確定=取込(imported) / 仮=手入力(manual) の
 * 表示トグルを保持し、サマリー・案件別マトリクスを取得する。
 */
export const useManhoursStore = defineStore('manhours', () => {
  const batches = ref<ManhourBatch[]>([]);
  const summary = ref<CapacitySummary | null>(null);
  const projectMatrix = ref<ProjectMatrix | null>(null);
  const assigneeDetail = ref<AssigneeDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // 表示条件
  const selectedBatchId = ref<number | null>(null);
  const showImported = ref(true);
  const showProvisional = ref(true);

  function sourceParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (!showImported.value) p.imported = 'false';
    if (!showProvisional.value) p.manual = 'false';
    return p;
  }

  async function fetchBatches(fiscalYear?: number): Promise<void> {
    error.value = null;
    try {
      const res = await api.get<ManhourBatch[]>('/manhours/batches', {
        params: fiscalYear !== undefined ? { fiscalYear } : {},
      });
      batches.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load batches';
    }
  }

  async function fetchSummary(opts: {
    fiscalYear?: number;
    batchId?: number | null;
    /** undefined=絞り込み無し / null=未設定 / number=その組織所属の社員のみ */
    organizationId?: number | null;
  }): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = { ...sourceParams() };
      if (opts.fiscalYear !== undefined) params.fiscalYear = opts.fiscalYear;
      if (opts.batchId !== null && opts.batchId !== undefined)
        params.batchId = opts.batchId;
      if (opts.organizationId !== undefined) {
        params.organizationId = opts.organizationId === null ? 'null' : opts.organizationId;
      }
      const res = await api.get<CapacitySummary>('/manhours/summary', {
        params,
      });
      summary.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load summary';
    } finally {
      loading.value = false;
    }
  }

  async function fetchProjectMatrix(
    projectId: number,
    opts: { fiscalYear?: number; batchId?: number | null } = {},
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = { ...sourceParams() };
      if (opts.fiscalYear !== undefined) params.fiscalYear = opts.fiscalYear;
      if (opts.batchId !== null && opts.batchId !== undefined)
        params.batchId = opts.batchId;
      const res = await api.get<ProjectMatrix>(
        `/manhours/projects/${projectId}/matrix`,
        { params },
      );
      projectMatrix.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load project matrix';
    } finally {
      loading.value = false;
    }
  }

  async function fetchAssigneeDetail(
    assigneeId: number,
    opts: { fiscalYear?: number; batchId?: number | null } = {},
  ): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const params: Record<string, unknown> = { ...sourceParams() };
      if (opts.fiscalYear !== undefined) params.fiscalYear = opts.fiscalYear;
      if (opts.batchId !== null && opts.batchId !== undefined)
        params.batchId = opts.batchId;
      const res = await api.get<AssigneeDetail>(
        `/manhours/assignees/${assigneeId}/detail`,
        { params },
      );
      assigneeDetail.value = res.data;
    } catch (e: any) {
      error.value = e?.message ?? 'failed to load assignee detail';
    } finally {
      loading.value = false;
    }
  }

  async function saveManualEntry(input: ManualEntryInput): Promise<void> {
    await api.post('/manhours/manual-entries', input);
  }

  async function deleteManualEntry(id: number): Promise<void> {
    await api.delete(`/manhours/manual-entries/${id}`);
  }

  async function createManualProject(payload: {
    name: string;
    projectCode?: string | null;
    customerId?: number | null;
  }): Promise<Project> {
    const res = await api.post<Project>('/manhours/manual-projects', payload);
    return res.data;
  }

  async function deleteBatch(id: number): Promise<void> {
    await api.delete(`/manhours/batches/${id}`);
    batches.value = batches.value.filter((b) => b.id !== id);
  }

  return {
    batches,
    summary,
    projectMatrix,
    assigneeDetail,
    loading,
    error,
    selectedBatchId,
    showImported,
    showProvisional,
    fetchBatches,
    fetchSummary,
    fetchProjectMatrix,
    fetchAssigneeDetail,
    saveManualEntry,
    deleteManualEntry,
    createManualProject,
    deleteBatch,
  };
});
