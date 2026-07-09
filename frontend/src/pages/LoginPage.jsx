import { Button, Form, Input, Modal, message } from 'antd';
import { LeftOutlined, LockOutlined, RightOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearAdminSession, saveAdminSession } from '../auth.js';
import { apiErrorMessage } from '../services/apiClient.js';
import { loginAdmin, previewLogin } from '../services/authApi.js';
import { getDefaultWorkspacePath } from '../workspaceModules.jsx';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const redirectTo = location.state?.from?.pathname;

  const confirmSchoolCredentials = (values) => new Promise((resolve) => {
    Modal.confirm({
      title: '确认这是你的账号密码？',
      content: (
        <div>
          <p>将会作为后续登录学校系统的凭证：</p>
          <p>密码将安全储存至服务器，无需担心隐私问题</p>
          <p>账号：{values.username}</p>
          <p>密码：{values.password}</p>
        </div>
      ),
      okText: '确认',
      cancelText: '返回',
      okButtonProps: { type: 'primary' },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      const preview = await previewLogin(values.username);
      if (preview.requires_school_credential_confirmation) {
        const confirmed = await confirmSchoolCredentials(values);
        if (!confirmed) {
          return;
        }
      }

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
            <p>请输入 26A + 你的学号 的账户密码，这将会作为登录凭据</p>
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
                placeholder="请输入账号"
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


        </div>
      </section>
    </main>
  );
}
