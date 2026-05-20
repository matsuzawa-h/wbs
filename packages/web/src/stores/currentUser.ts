import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useEmployeesStore } from '@/stores/employees';
import type { Employee } from '@/types';

/**
 * 「自分は誰か」をブラウザ単位で覚える簡易ID。社内LANクローズドの運用
 * 前提なので認証は無く、ログイン画面は社員リストから自分を選ぶピッカー。
 * localStorage に id を保存し、リロードしても継続する。
 */
const LS_KEY = 'wbs.currentEmployeeId';

function loadFromStorage(): number | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function saveToStorage(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, String(id));
  } catch {
    // localStorage 不可なら諦める（SSR/private 等）。次回ピッカーで選び直し。
  }
}

export const useCurrentUserStore = defineStore('currentUser', () => {
  const employees = useEmployeesStore();
  const currentId = ref<number | null>(loadFromStorage());

  const current = computed<Employee | null>(() => {
    if (currentId.value === null) return null;
    return employees.items.find((e) => e.id === currentId.value) ?? null;
  });

  const isLoggedIn = computed(() => currentId.value !== null);

  function login(employeeId: number): void {
    currentId.value = employeeId;
    saveToStorage(employeeId);
  }

  function logout(): void {
    currentId.value = null;
    saveToStorage(null);
  }

  // 社員マスタが読込まれたあとで「自分」が存在しない場合は自動 logout。
  // 例: ログイン中の社員が他で削除された／localStorage に古い id が残っている。
  // employees.items が空の間（fetch 前）は無効化判定しない。
  watch(
    () => [employees.items.length, currentId.value] as const,
    ([len, id]) => {
      if (id === null || len === 0) return;
      const exists = employees.items.some((e) => e.id === id);
      if (!exists) logout();
    },
  );

  return { currentId, current, isLoggedIn, login, logout };
});
