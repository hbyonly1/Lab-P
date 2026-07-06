import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Switch, Tabs, message, Spin } from 'antd';
import { CodeOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { getAiConfig, testAiConnection, updateAiConfig } from '../../../services/aiApi.js';
import { getAutomationConfig, updateAutomationConfig } from '../../../services/automationConfigApi.js';
import { JsonConfigEditor } from '../../../components/config/JsonConfigEditor.jsx';

const getAiTestErrorText = (result) => (
  result?.error || result?.detail || result?.message || '测试请求失败，但后端没有返回具体错误。'
);

export default function SettingsPage() {
  const [aiForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);
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
      source: config.source || 'env',
      provider: config.provider || 'openai_compatible',
      api_key_configured: config.api_key_configured ? '已配置' : '未配置',
      base_url: config.base_url || '',
      default_model: config.default_model || '',
      default_timeout_seconds: config.default_timeout_seconds,
      default_temperature: config.default_temperature,
      default_max_images_per_task: config.default_max_images_per_task,
      auto_recognize: config.auto_recognize || false,
      image_recognition_model: config.image_recognition_model || '',
      image_recognition_timeout_seconds: config.image_recognition_timeout_seconds,
      image_recognition_temperature: config.image_recognition_temperature,
      image_recognition_max_images_per_task: config.image_recognition_max_images_per_task,
      answer_generation_model: config.answer_generation_model || '',
      answer_generation_timeout_seconds: config.answer_generation_timeout_seconds,
      answer_generation_temperature: config.answer_generation_temperature,
      captcha_model: config.captcha_model || '',
      captcha_timeout_seconds: config.captcha_timeout_seconds,
      captcha_temperature: config.captcha_temperature,
      captcha_prompt: config.captcha_prompt || '',
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

  const handleTestAiConnection = async () => {
    try {
      setTestingAi(true);
      const result = await testAiConnection();
      setAiTestResult(result);
      if (result.ok) {
        message.success('AI 连通性测试成功');
      } else {
        message.error(`AI 连通性测试失败：${getAiTestErrorText(result)}`, 8);
      }
    } catch (e) {
      const result = {
        ok: false,
        error: e.response?.data?.detail || e.message || '测试请求失败',
      };
      setAiTestResult(result);
      message.error(`AI 连通性测试失败：${getAiTestErrorText(result)}`, 8);
    } finally {
      setTestingAi(false);
    }
  };

  const handleSaveAiConfig = async (values) => {
    try {
      setSavingAi(true);
      const payload = {
        provider: values.provider,
        base_url: values.base_url,
        default_model: values.default_model,
        default_timeout_seconds: values.default_timeout_seconds,
        default_temperature: values.default_temperature,
        default_max_images_per_task: values.default_max_images_per_task,
        auto_recognize: values.auto_recognize === true || values.auto_recognize === '启用',
        image_recognition_model: values.image_recognition_model,
        image_recognition_timeout_seconds: values.image_recognition_timeout_seconds,
        image_recognition_temperature: values.image_recognition_temperature,
        image_recognition_max_images_per_task: values.image_recognition_max_images_per_task,
        answer_generation_model: values.answer_generation_model,
        answer_generation_timeout_seconds: values.answer_generation_timeout_seconds,
        answer_generation_temperature: values.answer_generation_temperature,
        captcha_model: values.captcha_model,
        captcha_timeout_seconds: values.captcha_timeout_seconds,
        captcha_temperature: values.captcha_temperature,
        captcha_prompt: values.captcha_prompt,
      };
      const saved = await updateAiConfig(payload);
      aiForm.setFieldsValue({
        ...saved,
        source: saved.source || 'database',
        api_key_configured: saved.api_key_configured ? '已配置' : '未配置',
        auto_recognize: saved.auto_recognize,
      });
      message.success('AI 配置已保存');
    } catch (e) {
      message.error(e.response?.data?.detail || '保存 AI 配置失败');
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

  const handleToggleAutomationSyncPolicy = async (field, checked) => {
    const nextConfig = {
      ...automationConfigJson,
      syncPolicy: {
        ...(automationConfigJson.syncPolicy || {}),
        [field]: checked,
      },
    };
    setAutomationConfigJson(nextConfig);
    try {
      await handleSaveAutomationConfig(nextConfig);
      message.success('学校详情自动加载设置已保存');
    } catch (e) {
      setAutomationConfigJson(automationConfigJson);
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
          <Form form={aiForm} layout="vertical" requiredMark={false} onFinish={handleSaveAiConfig}>
            <Alert
              type="info"
              showIcon
              message="AI Key 来自 .env / 进程环境变量；模型、Base URL、温度、超时等业务配置保存在数据库，保存后立即生效。"
              style={{ marginBottom: 16 }}
            />
            <div className="settings-grid">
              <Form.Item name="source" label="配置来源">
                <Input disabled style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="api_key_configured" label="API Key">
                <Input disabled style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="base_url" label="Base URL" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="default_model" label="默认模型" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="default_timeout_seconds" label="默认超时 (秒)">
                <InputNumber min={10} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="default_temperature" label="默认温度">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="default_max_images_per_task" label="默认单次最大图片数">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="auto_recognize" label="上传后自动识别" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="image_recognition_model" label="图片识别模型" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="image_recognition_timeout_seconds" label="图片识别超时 (秒)">
                <InputNumber min={10} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="image_recognition_temperature" label="图片识别温度">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="image_recognition_max_images_per_task" label="图片识别单次最大图片数">
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="answer_generation_model" label="实验问题生成模型" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="answer_generation_timeout_seconds" label="问题生成超时 (秒)">
                <InputNumber min={10} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="answer_generation_temperature" label="问题生成温度">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="captcha_model" label="验证码识别模型" rules={[{ required: true }]}>
                <Input style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="captcha_timeout_seconds" label="验证码超时 (秒)">
                <InputNumber min={10} max={300} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="captcha_temperature" label="验证码温度">
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="captcha_prompt" label="验证码 Prompt" rules={[{ required: true }]}>
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
              </Form.Item>
            </div>
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <Button icon={<RobotOutlined />} loading={testingAi} onClick={handleTestAiConnection}>
                测试连通性
              </Button>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingAi}>
                保存 AI 配置
              </Button>
            </div>
          </Form>
          {aiTestResult && (
            <Alert
              type={aiTestResult.ok ? 'success' : 'error'}
              showIcon
              message={aiTestResult.ok ? 'AI 连通性测试成功' : `AI 连通性测试失败：${getAiTestErrorText(aiTestResult)}`}
              description={
                aiTestResult.ok
                  ? `模型：${aiTestResult.model || '-'}；输出：${aiTestResult.output || ''}`
                  : `错误码：${aiTestResult.error_code || '-'}；模型：${aiTestResult.model || '-'}；Base URL：${aiTestResult.base_url || '-'}`
              }
              style={{ marginTop: 16 }}
            />
          )}
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
        <section className="settings-panel settings-automation-config-panel">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '4px 0 10px',
              borderBottom: '1px solid #eef0f5',
              marginBottom: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>学校详情自动加载</div>
              <div style={{ marginTop: 2, color: '#6b7280', fontSize: 12 }}>控制打开实验详情页时是否自动读取学校系统已填写数据。</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', fontSize: 13 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                学生
                <Switch
                  size="small"
                  checked={automationConfigJson.syncPolicy?.autoLoadDetailForStudent ?? true}
                  loading={savingAutomation}
                  onChange={(checked) => handleToggleAutomationSyncPolicy('autoLoadDetailForStudent', checked)}
                />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Admin / Reviewer
                <Switch
                  size="small"
                  checked={automationConfigJson.syncPolicy?.autoLoadDetailForInternalUser ?? false}
                  loading={savingAutomation}
                  onChange={(checked) => handleToggleAutomationSyncPolicy('autoLoadDetailForInternalUser', checked)}
                />
              </span>
            </div>
          </div>
          <JsonConfigEditor
            value={automationConfigJson}
            label="raw JSON"
            saveText="保存自动化配置"
            saving={savingAutomation}
            onSave={handleSaveAutomationConfig}
            successMessage="自动化配置已保存"
            fullScreen={true}
          />
        </section>
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
