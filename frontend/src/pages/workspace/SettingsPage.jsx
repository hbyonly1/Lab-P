import { Button, Form, Input, InputNumber, Select, Space, Switch, Tabs, message } from 'antd';
import {
  CloudUploadOutlined,
  LockOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons';

const settingGroups = [
  {
    key: 'ai',
    label: 'AI 配置',
    icon: <RobotOutlined />,
    description: '控制高光识别模型、fallback 和单集生成策略。',
  },
  {
    key: 'review',
    label: '审核规则',
    icon: <SafetyCertificateOutlined />,
    description: '配置发布前校验、风险提示和默认审核状态。',
  },
  {
    key: 'player',
    label: '播放端',
    icon: <PlayCircleOutlined />,
    description: '配置互动浮层展示、特效和行为回传策略。',
  },
  {
    key: 'upload',
    label: '上传限制',
    icon: <CloudUploadOutlined />,
    description: '配置视频、字幕和上传后处理方式。',
  },
  {
    key: 'security',
    label: '安全',
    icon: <LockOutlined />,
    description: '配置登录有效期、角色能力和后台操作审计。',
  },
];

const initialValues = {
  ai: {
    llm_enabled: false,
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    timeout_seconds: 60,
    fallback_enabled: true,
    max_highlights_per_episode: 8,
    allow_force_reanalyze: true,
  },
  review: {
    require_no_overlap: true,
    min_confidence: 0.65,
    default_highlight_status: 'draft',
    confirm_bulk_publish: true,
    mark_low_confidence: true,
  },
  player: {
    overlay_duration_ms: 4000,
    default_position: 'bottom',
    enable_effects: true,
    record_ignore: true,
    anonymous_user_strategy: 'persisted_device_id',
  },
  upload: {
    max_video_size_mb: 500,
    allowed_subtitle_formats: 'srt,vtt,txt',
    allow_without_subtitle: true,
    default_duration_seconds: 0,
    auto_enqueue_analysis: false,
  },
  security: {
    jwt_expire_minutes: 120,
    uploader_can_create_drama: false,
    uploader_can_force_reanalyze: true,
    audit_admin_actions: true,
    session_expiry_action: 'redirect_login',
  },
};

function disabledSave() {
  message.info('设置保存接口尚未接入，本页先用于确认配置项和交互形态');
}

export default function SettingsPage() {
  const [form] = Form.useForm();

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
        {group.key === 'review' ? <ReviewSettings /> : null}
        {group.key === 'player' ? <PlayerSettings /> : null}
        {group.key === 'upload' ? <UploadSettings /> : null}
        {group.key === 'security' ? <SecuritySettings /> : null}
      </section>
    ),
  }));

  return (
    <section className="settings-page">
      <Form form={form} layout="vertical" initialValues={initialValues}>
        <div className="settings-tabs-shell">
          <Tabs
            className="settings-tabs"
            tabBarExtraContent={
              <Space>
                <Button onClick={() => form.resetFields()}>恢复默认</Button>
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
      <Form.Item name={['ai', 'llm_enabled']} label="启用 LLM" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['ai', 'fallback_enabled']} label="无 Key 时启用 fallback" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['ai', 'base_url']} label="LLM Base URL">
        <Input />
      </Form.Item>
      <Form.Item name={['ai', 'model']} label="模型">
        <Input />
      </Form.Item>
      <Form.Item name={['ai', 'timeout_seconds']} label="超时时间（秒）">
        <InputNumber min={5} max={300} />
      </Form.Item>
      <Form.Item name={['ai', 'max_highlights_per_episode']} label="单集最大高光数">
        <InputNumber min={1} max={30} />
      </Form.Item>
      <Form.Item name={['ai', 'allow_force_reanalyze']} label="允许强制重跑" valuePropName="checked">
        <Switch />
      </Form.Item>
    </div>
  );
}

function ReviewSettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['review', 'require_no_overlap']} label="发布前校验时间重叠" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['review', 'mark_low_confidence']} label="低置信度标记风险" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['review', 'min_confidence']} label="最低置信度建议阈值">
        <InputNumber min={0} max={1} step={0.05} />
      </Form.Item>
      <Form.Item name={['review', 'default_highlight_status']} label="新高光默认状态">
        <Select
          options={[
            { value: 'draft', label: 'draft' },
            { value: 'published', label: 'published' },
            { value: 'rejected', label: 'rejected' },
          ]}
        />
      </Form.Item>
      <Form.Item name={['review', 'confirm_bulk_publish']} label="批量发布二次确认" valuePropName="checked">
        <Switch />
      </Form.Item>
    </div>
  );
}

function PlayerSettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['player', 'overlay_duration_ms']} label="高光浮层展示时长（ms）">
        <InputNumber min={1000} max={10000} step={500} />
      </Form.Item>
      <Form.Item name={['player', 'default_position']} label="默认浮层位置">
        <Select
          options={[
            { value: 'bottom', label: 'bottom' },
            { value: 'right', label: 'right' },
            { value: 'center', label: 'center' },
          ]}
        />
      </Form.Item>
      <Form.Item name={['player', 'enable_effects']} label="启用播放端特效" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['player', 'record_ignore']} label="记录 ignore 行为" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['player', 'anonymous_user_strategy']} label="匿名用户策略">
        <Select
          options={[
            { value: 'persisted_device_id', label: '持久化设备 ID' },
            { value: 'session_only', label: '仅当前会话' },
          ]}
        />
      </Form.Item>
    </div>
  );
}

function UploadSettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['upload', 'max_video_size_mb']} label="MP4 最大文件大小（MB）">
        <InputNumber min={10} max={5000} />
      </Form.Item>
      <Form.Item name={['upload', 'allowed_subtitle_formats']} label="支持字幕格式">
        <Input />
      </Form.Item>
      <Form.Item name={['upload', 'allow_without_subtitle']} label="允许无字幕上传" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['upload', 'default_duration_seconds']} label="默认剧集时长（秒）">
        <InputNumber min={0} />
      </Form.Item>
      <Form.Item name={['upload', 'auto_enqueue_analysis']} label="上传后自动进入 AI 生产队列" valuePropName="checked">
        <Switch />
      </Form.Item>
    </div>
  );
}

function SecuritySettings() {
  return (
    <div className="settings-grid">
      <Form.Item name={['security', 'jwt_expire_minutes']} label="JWT 有效期（分钟）">
        <InputNumber min={5} max={1440} />
      </Form.Item>
      <Form.Item name={['security', 'uploader_can_create_drama']} label="uploader 可创建短剧" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['security', 'uploader_can_force_reanalyze']} label="uploader 可强制重跑" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['security', 'audit_admin_actions']} label="记录后台操作日志" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item name={['security', 'session_expiry_action']} label="登录过期行为">
        <Select
          options={[
            { value: 'redirect_login', label: '跳转登录页' },
            { value: 'show_modal', label: '弹窗提示' },
          ]}
        />
      </Form.Item>
    </div>
  );
}
