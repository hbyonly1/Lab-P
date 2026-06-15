import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Layout, Menu } from 'antd';
import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons';
import {
  getWorkspaceModuleByPath,
  getWorkspaceModulesForRole,
} from '../workspaceModules.jsx';
import { getAdminUserName, getAdminUserRole } from '../auth.js';

const { Sider, Content } = Layout;

export default function WorkspaceLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const userRole = getAdminUserRole();
  const accessibleModules = getWorkspaceModulesForRole(userRole);
  const currentModule = getWorkspaceModuleByPath(location.pathname);
  const isStudentContent = ['student-dashboard', 'student-experiments'].includes(currentModule.id);
  const userName = getAdminUserName();
  const userInitial = userName.trim().charAt(0).toUpperCase() || 'A';

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
        collapsedWidth={76}
        collapsed={collapsed}
        trigger={null}
        className="workspace-sider"
      >
        <div className="workspace-brand">
          <div className="workspace-brand-copy">
            <strong>实验报告</strong>
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
              <strong>{userName}</strong>
              <span>学号：{userName}</span>
            </span>
          </div>
        </div>
      </Sider>
      <Layout className="workspace-main">
        <Content className={`workspace-content${isStudentContent ? ' is-dashboard-content' : ''}`}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
