import { Button, Form, Input, InputNumber, Select, Space, Switch, Tabs, message } from 'antd';
import {
  BugOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  DEFAULT_DEBUG_SERVICE_ROLE,
  debugServiceRoles,
  getDebugServiceRole,
  saveDebugServiceRole,
} from './debugRoleStore.js';

const settingGroups = [
  {
    key: 'ai',
    label: 'AI 配置',
    icon: <RobotOutlined />,
  },
  {
    key: 'debug',
    label: '调试',
    icon: <BugOutlined />,
  },
];

const initialValues = {
  ai: {
    vision_enabled: true,
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    timeout_seconds: 60,
    fallback_enabled: true,
    max_images_per_task: 8,
    allow_force_recognize: true,
  },
  debug: {
    service_role: getDebugServiceRole(),
  },
};

function disabledSave() {
  message.info('设置保存接口尚未接入，本页先用于确认配置项和调试交互');
}

export default function SettingsPage() {
  const [form] = Form.useForm();

  const handleValuesChange = (changedValues) => {
    const role = changedValues?.debug?.service_role;
    if (role) {
      saveDebugServiceRole(role);
      message.success(`已切换为 ${role.toUpperCase()} 调试角色`);
    }
  };

  const tabItems = settingGroups.map((group) => ({
    key: group.key,
    label: (
      <span className="settings-tab-label">
        {group.icon}
        {group.label}
      </span>
    ),
    children: (
      <section className="settings-panel">
        {group.key === 'ai' ? <AiSettings /> : null}
        {group.key === 'debug' ? <DebugSettings /> : null}
      </section>
    ),
  }));

  return (
    <section className="settings-page">
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={handleValuesChange}
      >
        <div className="settings-tabs-shell">
          <Tabs
            className="settings-tabs"
            tabBarExtraContent={
              <Space>
                <Button onClick={() => {
                  form.resetFields();
                  form.setFieldValue(['debug', 'service_role'], DEFAULT_DEBUG_SERVICE_ROLE);
                  saveDebugServiceRole(DEFAULT_DEBUG_SERVICE_ROLE);
                }}>
                  恢复默认
                </Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={disabledSave}>
                  保存设置
                </Button>
              </Space>
            }
            items={tabItems}
          />
        </div>
      </Form>
    </section>
  );
}

function AiSettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['ai', 'vision_enabled']} label="启用图片识别" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['ai', 'fallback_enabled']} label="无 Key 时启用 fallback" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['ai', 'base_url']} label="AI Base URL">
        <Input />
      </Form.Item>
      <Form.Item name={['ai', 'model']} label="识别模型">
        <Input />
      </Form.Item>
      <Form.Item name={['ai', 'timeout_seconds']} label="超时时间（秒）">
        <InputNumber min={5} max={300} />
      </Form.Item>
      <Form.Item name={['ai', 'max_images_per_task']} label="单次最多图片数">
        <InputNumber min={1} max={30} />
      </Form.Item>
      <Form.Item name={['ai', 'allow_force_recognize']} label="允许重新识别" valuePropName="checked">
        <Switch />
      </Form.Item>
    </div>
  );
}

function DebugSettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['debug', 'service_role']} label="调试角色 role">
        <Select options={debugServiceRoles} />
      </Form.Item>
    </div>
  );
}
