import { useState, useEffect } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Tabs, Form, Input, Button, message, Space, Card, Typography, Spin, Collapse } from 'antd';
import { buildExperimentConfig } from '../../../services/experimentConfigStore.js';
import { ExperimentDetailView } from '../student/StudentExperimentDetailPage.jsx';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { getAiPromptTemplate, updateAiPromptTemplate, previewAiPromptTemplate } from '../../../services/aiApi.js';
import { CodeOutlined, SaveOutlined } from '@ant-design/icons';
import { JsonConfigEditor } from '../../../components/config/JsonConfigEditor.jsx';
import { FullScreenSettingsPanel } from '../../../components/config/FullScreenSettingsPanel.jsx';
import Editor from '@monaco-editor/react';

const { Title, Text, Paragraph } = Typography;

const DEFAULT_RECOGNITION_SYSTEM = "不推断、不补全、不计算；看不清填\"\"；注意单位，按表头和行名要求换算成目标表格数值，不带单位；只返回 JSON object。";
const DEFAULT_GENERATION_SYSTEM = "回答问题时直接输出答案即可，不要采用任何markdown和序号，每一点用句号分割即可。";

function ExperimentRawConfigTab({ experimentId, configJson, onSaved }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async (parsedConfig) => {
    try {
      setSaving(true);
      const saved = await experimentsApi.updateExperimentRawConfig(experimentId, parsedConfig);
      onSaved(saved.config_json);
      return saved.config_json;
    } catch (e) {
      message.error(e.response?.data?.detail || '保存配置失败，请检查 JSON 内容或后端日志');
      throw e;
    } finally {
      setSaving(false);
    }
  };

  return (
    <JsonConfigEditor
      value={configJson}
      saveText="保存配置"
      saving={saving}
      onSave={handleSave}
      successMessage="实验配置已保存"
      className="settings-panel settings-automation-panel admin-experiment-raw-config-panel"
      rows={30}
      fullScreen={true}
    />
  );
}

function ExperimentSettingsTab({ experimentId }) {
  const [formulasText, setFormulasText] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchFormulas = async () => {
      try {
        const res = await experimentsApi.getExperimentFormulas(experimentId);
        const formulaStr = Object.entries(res.formulas || {})
          .map(([k, v]) => `${k} = ${v}`)
          .join('\n');
        setFormulasText(formulaStr);
      } catch (e) {
        message.error('无法加载计算规则配置');
      }
    };
    fetchFormulas();
  }, [experimentId]);

  const onSaveFormulas = async () => {
    setLoading(true);
    try {
      const lines = formulasText.split('\n');
      const formulaObj = {};
      lines.forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const val = parts.slice(1).join('=').trim();
          if (key && val) {
            formulaObj[key] = val;
          }
        }
      });
      await experimentsApi.updateExperimentFormulas(experimentId, formulaObj);
      message.success('计算规则保存成功');
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
    }
  };

  const description = (
    <div style={{ padding: '12px 18px', background: '#fafafa', borderRadius: '8px', border: '1px solid rgba(20, 20, 19, 0.08)' }}>
      <Paragraph style={{ marginBottom: 0 }}>
        <Text type="secondary">
          在此处配置实验数据的自动计算公式。每行一条规则，格式为：<Text code>目标节点 = 表达式</Text>。<br />
          例如：<Text code>B = v('A') + v('D')</Text> | <Text code>N4 = v('N10-0') * 2.5</Text> &nbsp;&nbsp;
          （<Text code>v('节点')</Text> 读取单个节点，<Text code>v('A','B')</Text> 读取节点序列，<Text code>v(1,2)</Text> 表示常量序列）
        </Text>
      </Paragraph>
    </div>
  );

  return (
    <FullScreenSettingsPanel
      description={description}
      actions={
        <Button type="primary" loading={loading} icon={<SaveOutlined />} onClick={onSaveFormulas}>
          保存规则配置
        </Button>
      }
    >
      <div style={{ flex: 1, minHeight: 300, border: '1px solid rgba(20, 20, 19, 0.12)', borderRadius: 8, overflow: 'hidden' }}>
        <Editor
          height="100%"
          language="ini"
          theme="vs"
          value={formulasText}
          loading="正在加载编辑器..."
          onChange={(val) => setFormulasText(val ?? '')}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            wordWrap: 'on',
          }}
        />
      </div>
    </FullScreenSettingsPanel>
  );
}

function ExperimentPromptTab({ experimentId, experimentConfig }) {
  const [promptForm] = Form.useForm();
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptPreviews, setPromptPreviews] = useState({ recognition: '', generation: '' });
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = window.previewTimer || { current: null };

  const promptPayload = (values = {}) => ({
    recognition_system_prompt: values.recognition_system_prompt,
    recognition_extra_prompt: values.recognition_extra_prompt,
    generation_system_prompt: values.generation_system_prompt,
    generation_extra_prompt: values.generation_extra_prompt,
  });

  const updatePreview = async (expId, currentValues) => {
    if (!expId) return;
    setPreviewLoading(true);
    const apiValues = promptPayload(currentValues);
    try {
      const result = await previewAiPromptTemplate(expId, apiValues);
      setPromptPreviews({
        recognition: result.recognition_prompt,
        generation: result.generation_prompt
      });
    } catch (e) {
      console.error("Preview fetch failed", e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePromptFormChange = (_, allValues) => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      updatePreview(experimentId, allValues);
    }, 500);
  };

  const loadPromptConfig = async () => {
    try {
      const template = await getAiPromptTemplate(experimentId);
      const newValues = {
        recognition_system_prompt: template.recognition_system_prompt || DEFAULT_RECOGNITION_SYSTEM,
        recognition_extra_prompt: template.recognition_extra_prompt || '',
        generation_system_prompt: template.generation_system_prompt || DEFAULT_GENERATION_SYSTEM,
        generation_extra_prompt: template.generation_extra_prompt || '',
      };
      promptForm.setFieldsValue(newValues);
      updatePreview(experimentId, newValues);
    } catch (e) {
      message.error('获取 Prompt 模板失败');
    }
  };

  useEffect(() => {
    loadPromptConfig();
  }, [experimentId, promptForm]);

  const handleSavePrompt = async (values) => {
    try {
      setSavingPrompt(true);
      const apiValues = promptPayload(values);
      await updateAiPromptTemplate(experimentId, apiValues);
      message.success('Prompt 模板已保存');
    } catch (e) {
      message.error(e.response?.data?.detail || '保存 Prompt 失败');
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <Form form={promptForm} layout="vertical" requiredMark={false} onFinish={handleSavePrompt} onValuesChange={handlePromptFormChange} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <FullScreenSettingsPanel
        actions={
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={savingPrompt}>
            保存 Prompt 模板
          </Button>
        }
      >
        <Collapse defaultActiveKey={['1', '2']} style={{ background: '#ffffff' }}>
          <Collapse.Panel header="图像识别 (数据提取) Prompt" key="1">
            <Form.Item
              name="recognition_system_prompt"
              label="系统指令 (System Prompt)"
            >
              <Input.TextArea rows={4} placeholder="例如：你是一个严格的实验手写数据提取器..." />
            </Form.Item>
            <Form.Item
              name="recognition_extra_prompt"
              label="附加说明 (保存到实验 JSON，追加在用户指令末尾)"
            >
              <Input.TextArea
                rows={3}
                placeholder="未配置识别附加说明"
              />
            </Form.Item>
            <div style={{ marginTop: 16, marginBottom: 8, fontSize: 14, color: '#595959', fontWeight: 500 }}>
              预览：
            </div>
            <Spin spinning={previewLoading}>
              <div style={{ fontSize: 13, color: '#262626', padding: '12px', background: '#fafafa', borderRadius: 6, border: '1px solid #d9d9d9', minHeight: 60 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                  {promptPreviews.recognition}
                </pre>
              </div>
            </Spin>
          </Collapse.Panel>
          <Collapse.Panel header="实验思考题生成 Prompt" key="2">
            <Form.Item
              name="generation_system_prompt"
              label="系统指令 (System Prompt)"
            >
              <Input.TextArea rows={4} placeholder="例如：你是一名物理实验助教..." />
            </Form.Item>
            <Form.Item
              name="generation_extra_prompt"
              label="附加说明 (保存到实验 JSON，追加在用户指令末尾)"
            >
              <Input.TextArea
                rows={3}
                placeholder="未配置思考题附加说明"
              />
            </Form.Item>
            <div style={{ marginTop: 16, marginBottom: 8, fontSize: 14, color: '#595959', fontWeight: 500 }}>
              预览：
            </div>
            <Spin spinning={previewLoading}>
              <div style={{ fontSize: 13, color: '#262626', padding: '12px', background: '#fafafa', borderRadius: 6, border: '1px solid #d9d9d9', minHeight: 60 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                  {promptPreviews.generation}
                </pre>
              </div>
            </Spin>
          </Collapse.Panel>
        </Collapse>
      </FullScreenSettingsPanel>
    </Form>
  );
}

export default function AdminExperimentPreviewPage() {
  const navigate = useNavigate();
  const { experimentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [experiment, setExperiment] = useState(null);
  const [rawExperimentConfig, setRawExperimentConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    setConfigError(null);
    experimentsApi.getExperimentRawConfig(experimentId)
      .then((rawConfig) => {
        if (!cancelled) {
          const config = rawConfig.config_json;
          setRawExperimentConfig(config);
          setExperiment(buildExperimentConfig(config));
        }
      })
      .catch((err) => {
        if (!cancelled) setConfigError(err.response?.data?.detail || err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  if (loadingConfig) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#fafafc' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!experiment || configError) {
    return <Navigate to="/workspace/admin/experiments" replace />;
  }

  const items = [
    {
      key: 'raw_config',
      label: (
        <span className="settings-tab-label">
          raw JSON
        </span>
      ),
      children: (
        <ExperimentRawConfigTab
          experimentId={experimentId}
          configJson={rawExperimentConfig}
          onSaved={(config) => {
            setRawExperimentConfig(config);
            setExperiment(buildExperimentConfig(config));
          }}
        />
      ),
    },
    {
      key: 'preview',
      label: '实验预览',
      children: (
        <ExperimentDetailView
          experiment={experiment}
          onBack={() => navigate('/workspace/admin/experiments')}
          showNodeInspector={true}
        />
      ),
    },
    {
      key: 'settings',
      label: '计算规则配置',
      children: <ExperimentSettingsTab experimentId={experimentId} />,
    },
    {
      key: 'prompt',
      label: 'Prompt模板配置',
      children: <ExperimentPromptTab experimentId={experimentId} experimentConfig={experiment} />,
    },
  ];
  const tabKeys = new Set(items.map((item) => item.key));
  const activeTab = tabKeys.has(searchParams.get('tab')) ? searchParams.get('tab') : 'raw_config';

  const handleTabChange = (nextTab) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', nextTab);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <section className="settings-page admin-experiment-preview-page full-height-page">
      <div className="settings-tabs-shell">
        <Tabs
          className="settings-tabs"
          activeKey={activeTab}
          onChange={handleTabChange}
          items={items}
        />
      </div>
    </section>
  );
}
