import { Button, Form, Input, message } from 'antd';
import { LeftOutlined, LockOutlined, RightOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearAdminSession, saveAdminSession } from '../auth.js';
import { apiErrorMessage } from '../services/apiClient.js';
import { loginAdmin } from '../services/authApi.js';
import { getDefaultWorkspacePath } from '../workspaceModules.jsx';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const redirectTo = location.state?.from?.pathname;

  const enterDemoRole = (role) => {
    const demoNames = {
      student: '2410000000',
      reviewer: 'reviewer',
      admin: 'admin',
    };
    const session = {
      accessToken: `demo-${role}-token`,
      username: demoNames[role],
      role,
    };
    saveAdminSession(session);
    message.success(`已进入${role}演示账号`);
    navigate(getDefaultWorkspacePath(role), { replace: true });
  };

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      const session = await loginAdmin(values);
      if (!['student', 'reviewer', 'admin'].includes(session.role)) {
        clearAdminSession();
        message.error('当前账号暂未开通平台权限。');
        return;
      }
      saveAdminSession(session);
      message.success('已进入实验报告平台');
      navigate(redirectTo ?? getDefaultWorkspacePath(session.role), { replace: true });
    } catch (error) {
      clearAdminSession();
      message.error(apiErrorMessage(error, '登录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <a className="login-brand" href="/">
        <LeftOutlined />
        返回入口页
      </a>

      <section className="login-shell">
        <div className="login-panel reveal-block">
          <div className="login-panel-head">
            <span>SIGN IN</span>
            <strong>实验报告平台登录</strong>
          </div>

          <Form layout="vertical" requiredMark={false} onFinish={handleSubmit}>
            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: '请输入账号' }]}
            >
              <Input
                autoComplete="username"
                prefix={<UserOutlined />}
                placeholder="学生输入学号，后台人员输入账号"
                size="large"
              />
            </Form.Item>

            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                autoComplete="current-password"
                prefix={<LockOutlined />}
                placeholder="请输入密码"
                size="large"
              />
            </Form.Item>

            <Button className="login-submit" htmlType="submit" type="primary" block loading={submitting}>
              登录
              <RightOutlined />
            </Button>
          </Form>

          <div className="demo-login-panel">
            <span>后端未接入时使用</span>
            <div className="demo-login-actions">
              <Button onClick={() => enterDemoRole('student')}>学生演示</Button>
              <Button onClick={() => enterDemoRole('reviewer')}>审核员演示</Button>
              <Button onClick={() => enterDemoRole('admin')}>管理员演示</Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
