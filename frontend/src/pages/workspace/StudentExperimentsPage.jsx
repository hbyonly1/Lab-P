import { useMemo } from 'react';
import { Button } from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

export const experimentConfigs = [
  {
    id: 'hall-effect',
    name: '霍尔法测量圆线圈和亥姆霍兹线圈轴线上的磁感应强度',
    status: 'not_started',
    requiredImages: [
      { key: '1.jpg', label: '原始数据记录页' },
      { key: '2.jpg', label: '计算过程页' },
      { key: '3.jpg', label: '实验问题页' },
    ],
    fixedFields: [
      { id: 'temperature', label: '实验温度', type: 'text' },
      { id: 'instrument', label: '仪器编号', type: 'text' },
    ],
    questions: [
      { id: 'q1', label: '实验问题 1' },
      { id: 'q2', label: '实验问题 2' },
    ],
  },
  {
    id: 'young-modulus',
    name: '杨氏模量的测定',
    status: 'need_upload',
    requiredImages: [
      { key: '1.jpg', label: '实验数据表照片' },
      { key: '2.jpg', label: '逐差法计算页' },
    ],
    fixedFields: [{ id: 'material', label: '样品材料', type: 'text' }],
    questions: [{ id: 'q1', label: '实验问题 1' }],
  },
  {
    id: 'franck-hertz',
    name: '弗兰克-赫兹实验',
    status: 'manual_review',
    requiredImages: [
      { key: '1.jpg', label: '实验曲线页' },
      { key: '2.jpg', label: '数据处理页' },
    ],
    fixedFields: [],
    questions: [{ id: 'q1', label: '实验问题 1' }],
  },
  {
    id: 'grating',
    name: '光栅衍射实验',
    status: 'submitted',
    requiredImages: [
      { key: '1.jpg', label: '原始数据页' },
      { key: '2.jpg', label: '计算与结论页' },
    ],
    fixedFields: [],
    questions: [],
  },
];

export const statusMeta = {
  not_started: { label: '待处理', tone: 'pending' },
  need_upload: { label: '待提交', tone: 'submit' },
  manual_review: { label: '进行中', tone: 'processing' },
  processing: { label: '进行中', tone: 'processing' },
  submitted: { label: '已完成', tone: 'completed' },
};

export default function StudentExperimentsPage() {
  const navigate = useNavigate();

  const metrics = useMemo(
    () => ({
      total: experimentConfigs.length,
      pending: experimentConfigs.filter((item) =>
        ['not_started', 'need_upload', 'processing'].includes(item.status),
      ).length,
      reviewing: experimentConfigs.filter((item) => item.status === 'manual_review').length,
      completed: experimentConfigs.filter((item) => item.status === 'submitted').length,
    }),
    [],
  );

  return (
    <section className="student-experiments-page">
      <header className="student-page-heading">
        <h1>实验提交</h1>
        <p>查看并提交你的全部实验任务</p>
      </header>

      <div className="student-status-overview">
        <StatusTile icon={<AppstoreOutlined />} label="全部实验" value={metrics.total} tone="blue" />
        <StatusTile icon={<CloudUploadOutlined />} label="待提交" value={metrics.pending} tone="amber" />
        <StatusTile icon={<LineChartOutlined />} label="人工审核中" value={metrics.reviewing} tone="green" />
        <StatusTile icon={<CheckCircleOutlined />} label="已完成" value={metrics.completed} tone="violet" />
      </div>

      <div className="experiment-list-panel">
        <div className="experiment-list-head">
          <span>实验名称</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        <div className="experiment-list">
          {experimentConfigs.map((experiment) => {
            const meta = statusMeta[experiment.status] ?? statusMeta.not_started;
            return (
              <article className="experiment-row" key={experiment.id}>
                <h3>{experiment.name}</h3>
                <span className={`experiment-status-tag is-${meta.tone}`}>
                  <i aria-hidden="true" />
                  {meta.label}
                </span>
                <div className="experiment-row-actions">
                  <Button
                    className="experiment-action-button"
                    type="link"
                    onClick={() => navigate(`/workspace/student/experiments/${experiment.id}`)}
                  >
                    编辑
                  </Button>
                  <Button className="experiment-action-button" type="link">
                    提交
                  </Button>
                  <Button className="experiment-action-button" type="link">
                    在系统里查看
                  </Button>
                  <Button className="experiment-action-button is-recognize" type="link" icon={<CrownOutlined />}>
                    一键提交 (Pro)
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function StatusTile({ icon, label, value, tone }) {
  return (
    <div className={`student-status-tile is-${tone}`}>
      <span className="student-status-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
