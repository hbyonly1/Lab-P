import { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Switch, Tabs, message, Spin } from 'antd';
import { CodeOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { getAiConfig, updateAiConfig } from '../../../services/aiApi.js';
import { getAutomationConfig, updateAutomationConfig } from '../../../services/automationConfigApi.js';
import { JsonConfigEditor } from '../../../components/config/JsonConfigEditor.jsx';

export default function SettingsPage() {
  const [aiForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [automationConfigJson, setAutomationConfigJson] = useState({});
  const [automationMeta, setAutomationMeta] = useState({
    name: 'default',
    schema_version: '1.0',
    is_active: true,
  });

  const fetchAiConfig = async () => {
    const config = await getAiConfig();
    aiForm.setFieldsValue({
      base_url: config.base_url || 'https://api.openai.com/v1',
      model: config.model || 'gpt-4o',
      fallback_model: config.fallback_model,
      api_key: config.api_key ? 'configured' : '',
      timeout_seconds: config.timeout_seconds || 60,
      temperature: config.temperature || 0.85,
      max_images_per_task: config.max_images_per_task || 8,
      max_concurrent_tasks: config.max_concurrent_tasks || 4,
      auto_recognize: config.auto_recognize || false,
    });
  };

  const fetchAutomationConfig = async () => {
    const config = await getAutomationConfig();
    setAutomationMeta({
      name: config.name || 'default',
      schema_version: config.schema_version || '1.0',
      is_active: config.is_active ?? true,
    });
    setAutomationConfigJson(config.config_json || {});
  };

  const fetchConfig = async () => {
    try {
      await Promise.all([fetchAiConfig(), fetchAutomationConfig()]);
    } catch (e) {
      message.error(e.response?.data?.detail || '获取系统配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSaveConfig = async (values) => {
    try {
      setSavingAi(true);
      await updateAiConfig(values);
      message.success('AI 基础配置已保存');
    } catch (e) {
      message.error(e.response?.data?.detail || '保存配置失败，请检查填写内容或后端日志');
    } finally {
      setSavingAi(false);
    }
  };

  const handleSaveAutomationConfig = async (parsedConfig) => {
    try {
      setSavingAutomation(true);
      const savedConfig = await updateAutomationConfig({
        ...automationMeta,
        config_json: parsedConfig,
      });
      setAutomationMeta({
        name: savedConfig.name || 'default',
        schema_version: savedConfig.schema_version || '1.0',
        is_active: savedConfig.is_active ?? true,
      });
      setAutomationConfigJson(savedConfig.config_json || {});
      return savedConfig.config_json || {};
    } catch (e) {
      message.error(e.response?.data?.detail || '保存自动化配置失败，请检查 JSON 内容或后端日志');
      throw e;
    } finally {
      setSavingAutomation(false);
    }
  };

  const tabItems = [
    {
      key: 'ai_config',
      label: (
        <span className="settings-tab-label">
          <RobotOutlined />
          AI 基础配置
        </span>
      ),
      children: (
        <section className="settings-panel">
          <Form form={aiForm} layout="vertical" requiredMark={false} onFinish={handleSaveConfig}>
            <div className="settings-grid">
              <Form.Item name="base_url" label="Base URL (兼容 OpenAI)" rules={[{ required: true }]}>
                <Input placeholder="例如: https://api.openai.com/v1" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="api_key" label="API Key">
                <Input placeholder="输入新 Key 将覆盖原有配置，为空则不修改" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="model" label="默认模型" rules={[{ required: true }]}>
                <Input placeholder="例如: gpt-4o" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="fallback_model" label="降级备用模型">
                <Input placeholder="当主模型失效时使用" style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="timeout_seconds" label="超时时间 (秒)">
                <InputNumber min={10} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="temperature" label="温度 (Temperature)">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="max_images_per_task" label="单次最大图片数">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="max_concurrent_tasks" label="最大并发任务数">
                <InputNumber min={1} max={50} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="auto_recognize" label="学生上传后自动触发识别" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingAi}>
                保存基础配置
              </Button>
            </div>
          </Form>
        </section>
      ),
    },
    {
      key: 'automation_config',
      label: (
        <span className="settings-tab-label">
          <CodeOutlined />
          自动化配置
        </span>
      ),
      children: (
        <JsonConfigEditor
          value={automationConfigJson}
          label="raw JSON"
          saveText="保存自动化配置"
          saving={savingAutomation}
          onSave={handleSaveAutomationConfig}
          successMessage="自动化配置已保存"
          fullScreen={true}
        />
      ),
    },
  ];

  if (loading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 100 }} />;

  return (
    <section className="settings-page full-height-page">
      <div className="settings-tabs-shell">
        <Tabs className="settings-tabs" items={tabItems} />
      </div>
    </section>
  );
}
