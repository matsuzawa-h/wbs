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

const routes: RouteRecordRaw[] = [
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
