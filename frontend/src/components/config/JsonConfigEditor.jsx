import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Button, Modal, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';

export function JsonConfigEditor({
  value,
  label,
  saveText,
  saving,
  onSave,
  confirmTitle,
  confirmContent,
  successMessage,
  className = 'settings-panel settings-automation-panel',
  rows = 24,
  fullScreen = false,
}) {
  const [editorText, setEditorText] = useState('{}');

  const editorHeight = useMemo(() => `${Math.max(480, rows * 24)}px`, [rows]);

  useEffect(() => {
    setEditorText(value ? JSON.stringify(value, null, 2) : '{}');
  }, [value]);

  const formatJson = () => {
    try {
      const rawText = editorText || '{}';
      const parsed = JSON.parse(rawText);
      setEditorText(JSON.stringify(parsed, null, 2));
      message.success('JSON 已格式化');
    } catch (e) {
      message.error('JSON 格式错误，无法格式化');
    }
  };

  const handleSubmit = async () => {
    let parsedConfig;
    try {
      parsedConfig = JSON.parse(editorText || '{}');
    } catch (e) {
      message.error('JSON 格式错误，请检查括号、逗号和引号');
      return;
    }

    if (!parsedConfig || Array.isArray(parsedConfig) || typeof parsedConfig !== 'object') {
      message.error('配置内容必须是 JSON object');
      return;
    }

    Modal.confirm({
      title: confirmTitle,
      content: confirmContent,
      okText: '确认保存',
      cancelText: '取消',
      onOk: async () => {
        const savedConfig = await onSave(parsedConfig);
        setEditorText(JSON.stringify(savedConfig || parsedConfig, null, 2));
        message.success(successMessage);
      },
    });
  };

  return (
    <section 
      className={className}
      style={fullScreen ? { display: 'flex', flexDirection: 'column', height: '100%' } : undefined}
    >
      {label && <div className="settings-json-editor-label">{label}</div>}
      <div className="settings-json-editor-shell" style={fullScreen ? { flex: 1, minHeight: 0 } : undefined}>
        <Editor
          height={fullScreen ? "100%" : editorHeight}
          language="json"
          theme="vs"
          value={editorText}
          loading="正在加载 JSON 编辑器..."
          onChange={(nextValue) => setEditorText(nextValue ?? '')}
          options={{
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            folding: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            fontSize: 13,
            formatOnPaste: true,
            formatOnType: true,
            minimap: { enabled: true },
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
          }}
          beforeMount={(monaco) => {
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
              validate: true,
              allowComments: false,
              trailingCommas: 'error',
            });
          }}
        />
      </div>
      <div className="settings-actions">
        <Button onClick={formatJson} disabled={saving}>
          格式化 JSON
        </Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSubmit}>
          {saveText}
        </Button>
      </div>
    </section>
  );
}
