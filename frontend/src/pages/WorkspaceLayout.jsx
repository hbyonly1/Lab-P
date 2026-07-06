import { useEffect, useMemo, useState, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Layout, Menu, Tooltip, Spin } from 'antd';
import { DoubleLeftOutlined, DoubleRightOutlined, LogoutOutlined } from '@ant-design/icons';
import {
  getWorkspaceModuleByPath,
  getWorkspaceModulesForRole,
} from '../workspaceModules.jsx';
import {
  getAdminPlatformUsername,
  getAdminStudentNo,
  getAdminUserName,
  getAdminUserRole,
  clearAdminSession,
  subscribeAuthSessionChanged,
} from '../auth.js';

const { Sider, Content } = Layout;

const DETAIL_ROUTE_PATTERNS = [
  /^\/workspace\/student\/experiments\/[^/]+$/,
  /^\/workspace\/reviewer\/tasks\/[^/]+$/,
];

export default function WorkspaceLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [, setSessionVersion] = useState(0);

  useEffect(() => subscribeAuthSessionChanged(() => {
    setSessionVersion((version) => version + 1);
  }), []);

  const userRole = getAdminUserRole();
  const accessibleModules = getWorkspaceModulesForRole(userRole);
  const currentModule = getWorkspaceModuleByPath(location.pathname);
  const isDetailRoute = DETAIL_ROUTE_PATTERNS.some((pattern) => pattern.test(location.pathname));
  const standardContentModules = [
    'student-dashboard',
    'student-experiments',
    'admin-experiments',
    'design-system',
  ];
  const isStandardContent = standardContentModules.includes(currentModule.id);
  const realName = getAdminUserName();
  const studentNo = getAdminStudentNo();
  const platformUsername = getAdminPlatformUsername();
  const primaryUserLabel = realName || (userRole === 'student' ? '姓名未同步' : platformUsername || '账号未同步');
  const secondaryUserLabel = studentNo ? `学号：${studentNo}` : platformUsername ? `账号：${platformUsername}` : '账号待同步';
  const userInitial = (realName || platformUsername || studentNo).trim().charAt(0).toUpperCase() || 'A';

  useEffect(() => {
    setCollapsed(isDetailRoute);
  }, [isDetailRoute]);

  const menuItems = useMemo(
    () =>
      accessibleModules.map((module) => ({
        key: module.id,
        icon: module.icon,
        label: module.title,
      })),
    [accessibleModules],
  );

  return (
    <Layout className="workspace-shell">
      <Sider
        width={210}
        collapsedWidth={56}
        collapsed={collapsed}
        trigger={null}
        className="workspace-sider"
      >
        <div className="workspace-brand">
          <div className="workspace-brand-copy">
            <strong>CUMTB Lab+</strong>
            <span>v0.1</span>
          </div>
          <Button
            type="text"
            className="workspace-collapse-button"
            icon={collapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          />
        </div>
        <Menu
          mode="inline"
          selectedKeys={[currentModule.id]}
          items={menuItems}
          onClick={({ key }) => {
            const targetModule = accessibleModules.find((module) => module.id === key);
            if (targetModule) {
              navigate(targetModule.path);
            }
          }}
        />
        <div className="workspace-sider-footer">
          <div className="workspace-footer-user">
            <Avatar className="workspace-user-avatar" size={34}>
              {userInitial}
            </Avatar>
            <span className="workspace-footer-user-copy">
              <strong>{primaryUserLabel}</strong>
              <span>{secondaryUserLabel}</span>
            </span>
            {!collapsed && (
              <Tooltip title="退出登录">
                <Button 
                  type="text" 
                  icon={<LogoutOutlined />} 
                  onClick={() => {
                    clearAdminSession();
                    navigate('/login');
                  }} 
                  className="logout-button"
                  style={{ marginLeft: 'auto', color: 'var(--color-ink-subdued)' }}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </Sider>
      <Layout className="workspace-main">
        <Content className={`workspace-content${isStandardContent ? ' is-standard-content' : ''}`}>
          <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}><Spin size="large" /></div>}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
