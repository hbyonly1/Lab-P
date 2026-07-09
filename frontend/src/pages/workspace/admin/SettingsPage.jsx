import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Select, Switch, Tabs, message, Spin, Modal } from 'antd';
import { CodeOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons';
import { getAiConfig, previewExperimentImageAutoMatchPrompt, testAiConnection, updateAiConfig, updateAiTaskOverrides } from '../../../services/aiApi.js';
import { getAutomationConfig, updateAutomationConfig } from '../../../services/automationConfigApi.js';
import { JsonConfigEditor } from '../../../components/config/JsonConfigEditor.jsx';

const getAiTestErrorText = (result) => (
  result?.error || result?.detail || result?.message || '测试请求失败，但后端没有返回具体错误。'
);

const AI_JSON_CONFIG_OPTIONS = [
  { value: 'default_ai_config', label: '原 AI 基础配置' },
  { value: 'experiment_image_auto_match', label: '融合图片匹配专用配置' },
  { value: 'image_recognition_retry', label: '重复识别备用模型配置' },
  { value: 'captcha', label: '验证码识别专用配置' },
];

const DEFAULT_IMAGE_AUTO_MATCH_CONFIG = {
  enabled: false,
  provider: 'openai_compatible',
  base_url: 'http://localhost:59663/v1',
  chat_completions_url: 'http://localhost:59663/v1/chat/completions',
  api_key: '',
  model: 'gpt-5.5',
  temperature: 0,
  timeout_seconds: 120,
  batch_size: 1,
  concurrency: 3,
  max_retries: 2,
  retry_delay_seconds: 30,
};

const DEFAULT_IMAGE_RECOGNITION_RETRY_CONFIG = {
  ...DEFAULT_IMAGE_AUTO_MATCH_CONFIG,
  enabled: false,
  batch_size: 5,
};

const DEFAULT_CAPTCHA_CONFIG = {
  ...DEFAULT_IMAGE_AUTO_MATCH_CONFIG,
  enabled: false,
  base_url: 'http://10.26.91.86:59663/v1',
  chat_completions_url: 'http://10.26.91.86:59663/v1/chat/completions',
  model: 'gpt-5.5',
  timeout_seconds: 30,
  batch_size: 1,
  concurrency: 1,
};

const buildDefaultAiConfigJson = (config = {}) => ({
  provider: config.provider || 'openai_compatible',
  api_key_configured: config.api_key_configured === true,
  base_url: config.base_url || '',
  default_model: config.default_model || '',
  image_recognition_model: config.image_recognition_model || '',
  image_recognition_retry_enabled: config.image_recognition_retry_enabled === true,
  answer_generation_model: config.answer_generation_model || '',
  captcha_model: config.captcha_model || '',
});

export default function SettingsPage() {
  const [aiForm] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [savingAiTaskOverrides, setSavingAiTaskOverrides] = useState(false);
  const [selectedAiJsonConfig, setSelectedAiJsonConfig] = useState('experiment_image_auto_match');
  const [aiConfigSnapshot, setAiConfigSnapshot] = useState({});
  const [aiTaskOverridesJson, setAiTaskOverridesJson] = useState({
    experiment_image_auto_match: DEFAULT_IMAGE_AUTO_MATCH_CONFIG,
    image_recognition_retry: DEFAULT_IMAGE_RECOGNITION_RETRY_CONFIG,
    captcha: DEFAULT_CAPTCHA_CONFIG,
  });
  const [loadingImageAssignmentPrompt, setLoadingImageAssignmentPrompt] = useState(false);
  const [imageAssignmentPromptPreview, setImageAssignmentPromptPreview] = useState(null);
  const [automationConfigJson, setAutomationConfigJson] = useState({});
  const [automationMeta, setAutomationMeta] = useState({
    name: 'default',
    schema_version: '1.0',
    is_active: true,
  });

  const fetchAiConfig = async () => {
    const config = await getAiConfig();
    setAiConfigSnapshot(config || {});
    setAiTaskOverridesJson({
      experiment_image_auto_match: {
        ...DEFAULT_IMAGE_AUTO_MATCH_CONFIG,
        ...((config.task_overrides_json || {}).experiment_image_auto_match || {}),
      },
      image_recognition_retry: {
        ...DEFAULT_IMAGE_RECOGNITION_RETRY_CONFIG,
        ...((config.task_overrides_json || {}).image_recognition_retry || {}),
      },
      captcha: {
        ...DEFAULT_CAPTCHA_CONFIG,
        ...((config.task_overrides_json || {}).captcha || {}),
      },
      ...(config.task_overrides_json || {}),
    });
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
      image_recognition_retry_enabled: config.image_recognition_retry_enabled || false,
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
        image_recognition_retry_enabled: values.image_recognition_retry_enabled === true || values.image_recognition_retry_enabled === '启用',
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
        image_recognition_retry_enabled: saved.image_recognition_retry_enabled,
      });
      message.success('AI 配置已保存');
    } catch (e) {
      message.error(e.response?.data?.detail || '保存 AI 配置失败');
    } finally {
      setSavingAi(false);
    }
  };

  const handleSaveAiTaskOverrideConfig = async (parsedConfig) => {
    if (selectedAiJsonConfig === 'default_ai_config') {
      message.info('原 AI 基础配置请使用上方表单保存。');
      return buildDefaultAiConfigJson(aiConfigSnapshot);
    }
    const nextOverrides = {
      ...aiTaskOverridesJson,
      [selectedAiJsonConfig]: parsedConfig,
    };
    try {
      setSavingAiTaskOverrides(true);
      const saved = await updateAiTaskOverrides(nextOverrides);
      const savedOverrides = saved.task_overrides_json || nextOverrides;
      setAiTaskOverridesJson(savedOverrides);
      return savedOverrides[selectedAiJsonConfig] || parsedConfig;
    } catch (e) {
      message.error(e.response?.data?.detail || '保存任务专用 AI JSON 配置失败');
      throw e;
    } finally {
      setSavingAiTaskOverrides(false);
    }
  };

  const selectedAiJsonValue = selectedAiJsonConfig === 'default_ai_config'
    ? buildDefaultAiConfigJson(aiConfigSnapshot)
    : selectedAiJsonConfig === 'captcha'
    ? {
        ...DEFAULT_CAPTCHA_CONFIG,
        ...(aiTaskOverridesJson.captcha || {}),
      }
    : selectedAiJsonConfig === 'image_recognition_retry'
    ? {
        ...DEFAULT_IMAGE_RECOGNITION_RETRY_CONFIG,
        ...(aiTaskOverridesJson.image_recognition_retry || {}),
      }
    : {
        ...DEFAULT_IMAGE_AUTO_MATCH_CONFIG,
        ...(aiTaskOverridesJson.experiment_image_auto_match || {}),
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

  const handleToggleFusedImageUpload = async (checked) => {
    const nextConfig = {
      ...automationConfigJson,
      oneClick: {
        ...(automationConfigJson.oneClick || {}),
        fusedImageUploadAiEnabled: checked,
      },
    };
    setAutomationConfigJson(nextConfig);
    try {
      await handleSaveAutomationConfig(nextConfig);
      message.success('融合图片上传设置已保存');
    } catch (e) {
      setAutomationConfigJson(automationConfigJson);
    }
  };

  const handleToggleFusedImageAutoConfirm = async (checked) => {
    const nextConfig = {
      ...automationConfigJson,
      oneClick: {
        ...(automationConfigJson.oneClick || {}),
        fusedImageAutoConfirmEnabled: checked,
      },
    };
    setAutomationConfigJson(nextConfig);
    try {
      await handleSaveAutomationConfig(nextConfig);
      message.success('融合图片自动流转设置已保存');
    } catch (e) {
      setAutomationConfigJson(automationConfigJson);
    }
  };

  const handleTogglePreprocessAutoCompute = async (checked) => {
    const nextConfig = {
      ...automationConfigJson,
      oneClick: {
        ...(automationConfigJson.oneClick || {}),
        preprocessAutoComputeEnabled: checked,
      },
    };
    setAutomationConfigJson(nextConfig);
    try {
      await handleSaveAutomationConfig(nextConfig);
      message.success('预处理一键计算设置已保存');
    } catch (e) {
      setAutomationConfigJson(automationConfigJson);
    }
  };

  const handlePreviewImageAssignmentPrompt = async () => {
    try {
      setLoadingImageAssignmentPrompt(true);
      const preview = await previewExperimentImageAutoMatchPrompt();
      setImageAssignmentPromptPreview(preview);
    } catch (e) {
      message.error(e.response?.data?.detail || '获取 Prompt 预览失败');
    } finally {
      setLoadingImageAssignmentPrompt(false);
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
              <Form.Item name="image_recognition_retry_enabled" label="重复识别切换备用模型" valuePropName="checked">
                <Switch />
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
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>AI 配置 JSON</div>
              <Select
                value={selectedAiJsonConfig}
                options={AI_JSON_CONFIG_OPTIONS}
                onChange={setSelectedAiJsonConfig}
                style={{ width: 260 }}
              />
            </div>
            {selectedAiJsonConfig === 'default_ai_config' ? (
              <Input.TextArea
                value={JSON.stringify(selectedAiJsonValue, null, 2)}
                readOnly
                autoSize={{ minRows: 12, maxRows: 18 }}
              />
            ) : (
              <JsonConfigEditor
                value={selectedAiJsonValue}
                label="JSON"
                saveText="保存任务专用 JSON"
                saving={savingAiTaskOverrides}
                onSave={handleSaveAiTaskOverrideConfig}
                successMessage="任务专用 AI JSON 配置已保存"
                rows={18}
                className="settings-panel settings-automation-panel"
              />
            )}
          </div>
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
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>一键批量提交图片上传</div>
              <div style={{ marginTop: 2, color: '#6b7280', fontSize: 12 }}>开启后，前端先展示一个总上传框，由 AI 辅助匹配到具体实验和图片槽。</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', fontSize: 13 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                融合图片上传（AI）
                <Switch
                  size="small"
                  checked={automationConfigJson.oneClick?.fusedImageUploadAiEnabled === true}
                  loading={savingAutomation}
                  onChange={handleToggleFusedImageUpload}
                />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                匹配后自动流转
                <Switch
                  size="small"
                  checked={automationConfigJson.oneClick?.fusedImageAutoConfirmEnabled !== false}
                  loading={savingAutomation}
                  onChange={handleToggleFusedImageAutoConfirm}
                />
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                AI识别后自动一键计算
                <Switch
                  size="small"
                  checked={automationConfigJson.oneClick?.preprocessAutoComputeEnabled === true}
                  loading={savingAutomation}
                  onChange={handleTogglePreprocessAutoCompute}
                />
              </span>
              <Button
                size="small"
                icon={<CodeOutlined />}
                loading={loadingImageAssignmentPrompt}
                onClick={handlePreviewImageAssignmentPrompt}
              >
                预览 Prompt
              </Button>
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
          <Modal
            title="融合图片匹配 Prompt 预览"
            open={!!imageAssignmentPromptPreview}
            onCancel={() => setImageAssignmentPromptPreview(null)}
            footer={<Button onClick={() => setImageAssignmentPromptPreview(null)}>关闭</Button>}
            width={900}
          >
            <Input.TextArea
              value={imageAssignmentPromptPreview?.prompt || ''}
              readOnly
              autoSize={{ minRows: 18, maxRows: 28 }}
            />
          </Modal>
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
