import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Employee } from '@/types';

export const useProjectMembersStore = defineStore('projectMembers', () => {
  // Members keyed by projectId — each project's panel manages its own selection.
  const byProject = ref<Record<number, Employee[]>>({});
  const loading = ref(false);

  function membersOf(projectId: number): Employee[] {
    return byProject.value[projectId] ?? [];
  }

  async function fetchMembers(projectId: number): Promise<Employee[]> {
    loading.value = true;
    try {
      const res = await api.get<Employee[]>(`/projects/${projectId}/members`);
      byProject.value = { ...byProject.value, [projectId]: res.data };
      return res.data;
    } finally {
      loading.value = false;
    }
  }

  async function setMembers(projectId: number, employeeIds: number[]): Promise<Employee[]> {
    const res = await api.put<Employee[]>(`/projects/${projectId}/members`, { employeeIds });
    byProject.value = { ...byProject.value, [projectId]: res.data };
    return res.data;
  }

  return { byProject, loading, membersOf, fetchMembers, setMembers };
});
