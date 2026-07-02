import {
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  BgColorsOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  MessageOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';

export const workspaceModules = [
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
    id: 'reviewer-tasks',
    path: '/workspace/reviewer/tasks',
    title: '审核任务',
    eyebrow: 'REVIEW',
    description: '对照图片审核 AI 识别结果，补充固定填空和实验问题。',
    icon: <AuditOutlined />,
    roles: ['admin', 'reviewer'],
  },
  {
    id: 'admin-experiments',
    path: '/workspace/admin/experiments',
    title: '实验配置',
    eyebrow: 'EXPERIMENTS',
    description: '上传 JSON 并预览实验页面配置效果。',
    icon: <ExperimentOutlined />,
    roles: ['admin'],
    status: 'JSON',
  },
  {
    id: 'admin-operation-logs',
    path: '/workspace/admin/operation-logs',
    title: '操作日志',
    eyebrow: 'LOGS',
    description: '追踪系统与人工操作的详细日志，支持排查故障和失败原因。',
    icon: <FileDoneOutlined />,
    roles: ['admin'],
    status: '全部操作',
  },
  {
    id: 'admin-feedback',
    path: '/workspace/admin/feedback',
    title: '用户反馈',
    eyebrow: 'FEEDBACK',
    description: '查看学生提交的使用反馈与问题报告。',
    icon: <MessageOutlined />,
    roles: ['admin'],
    status: '反馈',
  },
  {
    id: 'design-system',
    path: '/workspace/admin/design-system',
    title: '界面规范',
    eyebrow: 'UI',
    description: '沉淀按钮、卡片、表格和状态标签等后台页面通用规范。',
    icon: <BgColorsOutlined />,
    roles: ['admin'],
    status: '规范',
  },
  {
    id: 'settings',
    path: '/workspace/admin/settings',
    title: '平台配置',
    eyebrow: 'SETTINGS',
    description: '维护 AI 配置和前端调试角色。',
    icon: <SettingOutlined />,
    roles: ['admin'],
    status: '调试',
  },
  {
    id: 'student-dashboard',
    path: '/workspace/student/dashboard',
    title: '仪表盘',
    eyebrow: 'DASHBOARD',
    description: '查看当前服务计划、实验完成状态和待处理事项。',
    icon: <BarChartOutlined />,
    roles: ['student'],
    debugRoles: ['admin'],
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
    debugRoles: ['admin'],
    status: '实验列表',
  },
  {
    id: 'student-feedback',
    path: '/workspace/student/feedback',
    title: '反馈',
    eyebrow: 'FEEDBACK',
    description: '提交使用中遇到的问题或建议。',
    icon: <MessageOutlined />,
    roles: ['student'],
    debugRoles: ['admin'],
    status: '反馈',
  }
];

export function canAccessWorkspaceModule(module, role) {
  return module.roles.includes(role);
}

export function getWorkspaceModulesForRole(role) {
  return workspaceModules.filter((module) => module.roles.includes(role));
}

export function getDefaultWorkspacePath(role) {
  return (
    workspaceModules.find((module) => module.roles.includes(role))?.path ??
    getWorkspaceModulesForRole(role)[0]?.path ??
    '/login'
  );
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
