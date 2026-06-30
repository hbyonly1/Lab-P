import { Button, Input, InputNumber, Select, Space, Table } from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  GoldButton,
  LockedNotice,
  OutlineButton,
  PageHeading,
  StatCard,
  StatusBadge,
  TablePanel,
  UiPanel,
} from '../../components/ui/index.js';
import { STATUS_META } from '../../constants/statusEnums.js';
import { SectionShell, ExperimentDataTable, ExperimentImageUploader } from '../../components/experiment/index.js';

const mockDataTable = {
  caption: '电表校准数据表 (V2 组件)',
  columns: [
    { label: '校准点' },
    { label: '标准表读数', nodePattern: 'V_std_{1..5}' },
    { label: '改装表读数', nodePattern: 'V_mod_{1..5}' },
  ]
};

const mockImages = [
  { id: 'IMG_RAW_DATA', label: '原始数据记录表截图' },
  { id: 'IMG_CIRCUIT', label: '改装电路连接实物图' }
];

const mockImageSlots = {
  'IMG_RAW_DATA': [{ uid: '1', name: 'demo.png', url: 'https://via.placeholder.com/600x400.png?text=Demo+Image' }]
};

const sampleRows = [
  {
    id: 'sub_1001',
    experiment: '大学物理实验 A',
    status: 'reviewing',
    updated_at: '2 小时前',
  },
  {
    id: 'sub_1002',
    experiment: '杨氏模量的测定',
    status: 'incomplete',
    updated_at: '1 天前',
  },
  {
    id: 'sub_1003',
    experiment: '光栅衍射实验',
    status: 'completed',
    updated_at: '3 天前',
  },
];

export default function DesignSystemPage() {
  const columns = [
    {
      title: '实验任务',
      dataIndex: 'experiment',
      key: 'experiment',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const meta = STATUS_META[status] ?? STATUS_META.not_started;
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      },
    },
    {
      title: '最后更新',
      dataIndex: 'updated_at',
      key: 'updated_at',
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: () => <Button type="link">查看</Button>,
    },
  ];

  return (
    <section className="workspace-standard-page ui-design-page">
      <PageHeading
        title="界面规范"
        description="新页面优先复用这里展示的按钮、状态、卡片和表格容器。"
      />

      <div className="ui-spec-grid">
        <UiPanel className="ui-spec-panel">
          <h2>按钮</h2>
          <div className="ui-spec-row">
            <GoldButton icon={<CrownOutlined />}>黄金强调按钮</GoldButton>
            <Button type="primary" icon={<SaveOutlined />}>
              主按钮
            </Button>
            <OutlineButton icon={<ReloadOutlined />}>次按钮</OutlineButton>
            <Button className="ui-icon-button" icon={<ExperimentOutlined />} aria-label="图标按钮" />
          </div>
          <p className="ui-spec-note">涉及升级、Pro、付费放行等强提醒动作时使用黄金强调按钮。</p>
        </UiPanel>

        <UiPanel className="ui-spec-panel">
          <h2>状态标签</h2>
          <div className="ui-spec-row">
            <StatusBadge tone="pending">待处理</StatusBadge>
            <StatusBadge tone="submit">待提交</StatusBadge>
            <StatusBadge tone="processing">进行中</StatusBadge>
            <StatusBadge tone="completed">已完成</StatusBadge>
            <StatusBadge tone="failed">失败</StatusBadge>
          </div>
          <p className="ui-spec-note">状态 tone 应和 API contract 中的任务状态枚举保持映射关系。</p>
        </UiPanel>
      </div>

      <UiPanel className="ui-spec-panel">
        <h2>锁定提示</h2>
        <LockedNotice />
        <p className="ui-spec-note">Plus/Pro、权限未开放、后端校验未通过等锁定模块统一使用这个提示。</p>
      </UiPanel>

      <UiPanel className="ui-spec-panel">
        <h2>输入控件</h2>
        <div className="ui-control-grid">
          <Input placeholder="普通文本输入" />
          <Input.Password placeholder="密码输入" />
          <InputNumber min={0} placeholder="数字输入" />
          <Select
            placeholder="选择服务模式"
            options={[
              { value: 'assist', label: '工具辅助模式' },
              { value: 'full_submit', label: '完整自动提交' },
            ]}
          />
          <Input.TextArea placeholder="多行文本输入" rows={3} showCount maxLength={120} />
        </div>
        <p className="ui-spec-note">输入控件统一使用 8px 圆角、32px 基础高度、蓝色 focus 外环和浅灰边框。</p>
      </UiPanel>

      <div className="ui-stat-grid">
        <StatCard icon={<AppstoreOutlined />} label="全部实验" value={4} tone="blue" />
        <StatCard icon={<CloudUploadOutlined />} label="待提交" value={2} tone="amber" />
        <StatCard icon={<LineChartOutlined />} label="人工审核中" value={1} tone="green" />
        <StatCard icon={<CheckCircleOutlined />} label="已完成" value={1} tone="violet" />
      </div>

      <TablePanel
        title="表格容器"
        description="列表页统一用 TablePanel 承接标题、描述、操作区和 AntD Table。"
        actions={
          <Space>
            <Button icon={<ReloadOutlined />}>刷新</Button>
            <GoldButton icon={<CrownOutlined />}>一键提交</GoldButton>
          </Space>
        }
      >
        <Table columns={columns} dataSource={sampleRows} pagination={false} rowKey="id" scroll={{ x: 720 }} />
      </TablePanel>

      <UiPanel className="ui-spec-panel">
        <h2>实验工作台组件 (V2 Core)</h2>
        <p className="ui-spec-note" style={{ marginBottom: '24px' }}>
          以下组件为 V2 架构提取的核心界面组件，请在开发实验相关页面时强制复用，确保全站的物理实验交互体验一致（尤其是表格与图片关联的识别体验）。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <div>
            <h3 style={{ fontSize: '15px', color: '#141413', marginBottom: '16px' }}>1. 实验数据提取表格 (ExperimentDataTable)</h3>
            <ExperimentDataTable 
              dataTable={mockDataTable} 
              formValues={{ "V_std_1": "2.05" }} 
              metaInfo={{ computedIds: new Set(["V_std_1"]) }} 
            />
          </div>

          <div>
            <h3 style={{ fontSize: '15px', color: '#141413', marginBottom: '16px' }}>2. 实验图纸与 AI 识别工作台 (ExperimentImageUploader)</h3>
            <ExperimentImageUploader 
              images={mockImages}
              imageSlots={mockImageSlots}
              onImageUpload={() => {}}
              onRecognize={() => {}}
              isRecognizing={false}
              canUseRecognition={true}
              recognitionDef={{ imageRef: 'IMG_RAW_DATA' }}
              onRemoveImage={() => {}}
            />
          </div>
          
          <div>
            <h3 style={{ fontSize: '15px', color: '#141413', marginBottom: '16px' }}>3. 实验区块容器 (SectionShell)</h3>
            <SectionShell index="1." title="示例区块标题">
              <div style={{ padding: '24px', background: '#fff', borderRadius: '8px', border: '1px solid #e1e7f0' }}>
                这里是区块内部的内容。未来的所有新实验模块（比如数据表、图片上传、思考题等）都应包裹在 SectionShell 中。
              </div>
            </SectionShell>
          </div>
        </div>
      </UiPanel>
    </section>
  );
}
