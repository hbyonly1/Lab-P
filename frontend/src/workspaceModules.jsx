import {
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';

export const workspaceModules = [
  {
    id: 'student-dashboard',
    path: '/workspace/student/dashboard',
    title: '仪表盘',
    eyebrow: 'DASHBOARD',
    description: '查看当前服务计划、实验完成状态和待处理事项。',
    icon: <BarChartOutlined />,
    roles: ['student'],
    status: '总览',
  },
  {
    id: 'student-experiments',
    path: '/workspace/student/experiments',
    title: '我的实验',
    eyebrow: 'STUDENT',
    description: '查看需要提交的实验，上传实验数据图片并跟进处理状态。',
    icon: <ExperimentOutlined />,
    roles: ['student'],
    status: '实验列表',
  },
  {
    id: 'reviewer-tasks',
    path: '/workspace/reviewer/tasks',
    title: '审核任务',
    eyebrow: 'REVIEW',
    description: '对照图片审核 AI 识别结果，补充固定填空和实验问题。',
    icon: <AuditOutlined />,
    roles: ['reviewer'],
    status: '人工审核',
  },
  {
    id: 'admin-orders',
    path: '/workspace/admin/orders',
    title: '订单管理',
    eyebrow: 'PAYMENT',
    description: '核对人工收款，确认支付状态并放行实验任务。',
    icon: <CheckCircleOutlined />,
    roles: ['admin'],
    status: '人工收款',
  },
  {
    id: 'admin-submissions',
    path: '/workspace/admin/submissions',
    title: '任务管理',
    eyebrow: 'TASKS',
    description: '查看实验提交任务、处理异常并跟踪自动填报状态。',
    icon: <FileDoneOutlined />,
    roles: ['admin'],
    status: '提交任务',
  },
  {
    id: 'admin-review-tasks',
    path: '/workspace/admin/review-tasks',
    title: '审核分配',
    eyebrow: 'ASSIGN',
    description: '把完整提交任务分配给审核员处理。',
    icon: <TeamOutlined />,
    roles: ['admin'],
    status: '分配',
  },
  {
    id: 'settings',
    path: '/workspace/admin/settings',
    title: '平台配置',
    eyebrow: 'SETTINGS',
    description: '维护实验配置、DOM 节点表、Prompt 和安全策略。',
    icon: <SettingOutlined />,
    roles: ['admin'],
    status: '待接 API',
  }
];

export function canAccessWorkspaceModule(module, role) {
  return module.roles.includes(role);
}

export function getWorkspaceModulesForRole(role) {
  return workspaceModules.filter((module) => canAccessWorkspaceModule(module, role));
}

export function getDefaultWorkspacePath(role) {
  return getWorkspaceModulesForRole(role)[0]?.path ?? '/login';
}

export function getWorkspaceModuleById(id) {
  return workspaceModules.find((module) => module.id === id) ?? workspaceModules[0];
}

export function getWorkspaceModuleByPath(pathname) {
  return (
    workspaceModules.find((module) => pathname.startsWith(module.path)) ??
    workspaceModules[0]
  );
}
