import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import ProjectListPage from './pages/ProjectListPage.vue';
import GanttPage from './pages/GanttPage.vue';
import HolidayPage from './pages/HolidayPage.vue';
import EmployeePage from './pages/EmployeePage.vue';
import AssignmentsPage from './pages/AssignmentsPage.vue';
import CustomerPage from './pages/CustomerPage.vue';
import OrganizationPage from './pages/OrganizationPage.vue';
import DownloadsPage from './pages/DownloadsPage.vue';
import HelpPage from './pages/HelpPage.vue';
import ManhoursSummaryPage from './pages/ManhoursSummaryPage.vue';
import ProjectManhoursPage from './pages/ProjectManhoursPage.vue';
import LoginPage from './pages/LoginPage.vue';
import { useCurrentUserStore } from './stores/currentUser';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
  { path: '/', name: 'projects', component: ProjectListPage },
  {
    path: '/projects/:projectId/gantt',
    name: 'gantt',
    component: GanttPage,
    props: (route) => ({ projectId: Number(route.params.projectId) }),
  },
  { path: '/manhours', name: 'manhours', component: ManhoursSummaryPage },
  {
    path: '/projects/:projectId/manhours',
    name: 'project-manhours',
    component: ProjectManhoursPage,
    props: (route) => ({ projectId: Number(route.params.projectId) }),
  },
  { path: '/holidays', name: 'holidays', component: HolidayPage },
  { path: '/employees', name: 'employees', component: EmployeePage },
  { path: '/assignments', name: 'assignments', component: AssignmentsPage },
  { path: '/organizations', name: 'organizations', component: OrganizationPage },
  { path: '/customers', name: 'customers', component: CustomerPage },
  { path: '/downloads', name: 'downloads', component: DownloadsPage },
  { path: '/manual', name: 'manual', component: HelpPage },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// ログイン未済みなら /login にリダイレクト。public meta が付いているルート
// (/login 自身) は通す。社内 LAN 前提なので「自分は誰か」を選んでもらうだけ。
router.beforeEach((to) => {
  const isPublic = to.matched.some((r) => r.meta.public);
  if (isPublic) return true;
  const currentUser = useCurrentUserStore();
  if (currentUser.isLoggedIn) return true;
  return { name: 'login', query: { redirect: to.fullPath } };
});
