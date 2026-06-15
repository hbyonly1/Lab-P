import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, InputNumber, Upload, message } from 'antd';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { experimentConfigs, statusMeta } from './StudentExperimentsPage.jsx';

const dataRows = [
  { index: 1, distance: '30.0', imageDistance: '15.2', focalDistance: '10.1' },
  { index: 2, distance: '40.0', imageDistance: '13.5', focalDistance: '10.0' },
  { index: 3, distance: '50.0', imageDistance: '12.4', focalDistance: '9.9' },
  { index: 4, distance: '60.0', imageDistance: '11.6', focalDistance: '9.9' },
  { index: 5, distance: '70.0', imageDistance: '', focalDistance: '' },
];

const sectionCopy = {
  data: {
    index: '2.',
    title: '数据表格与图片识别',
    hint: '左侧填写表格，右侧上传对应图片并识别数据',
  },
  fixed: {
    index: '1.',
    title: '固定填空',
    hint: 'Plus/Pro 可解锁固定填空与主观内容辅助',
  },
  questions: {
    index: '3.',
    title: '实验问题',
    hint: '整理实验问答，提交前仍需人工确认',
  },
};

export default function StudentExperimentDetailPage() {
  const { experimentId } = useParams();
  const navigate = useNavigate();
  const previewStageRef = useRef(null);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

  const experiment = useMemo(
    () => experimentConfigs.find((item) => item.id === experimentId),
    [experimentId],
  );

  if (!experiment) {
    return <Navigate to="/workspace/student/experiments" replace />;
  }

  const status = statusMeta[experiment.status] ?? statusMeta.not_started;

  const handleBeforeUpload = (file) => {
    setUploadedImage(URL.createObjectURL(file));
    setScale(1);
    setOffset({ x: 0, y: 0 });
    return false;
  };

  const handleSave = () => {
    message.success('已保存当前实验草稿。');
  };

  const handleSubmit = () => {
    message.success('已提交实验任务，后续将接入后端校验与自动填报。');
  };

  const handleMouseDown = (event) => {
    if (!uploadedImage) return;
    setDragging(true);
    setDragStart({
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
    });
  };

  const handleMouseMove = (event) => {
    if (!dragging || !dragStart) return;
    setOffset({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    });
  };

  const stopDragging = () => {
    setDragging(false);
    setDragStart(null);
  };

  useEffect(() => {
    const previewStage = previewStageRef.current;
    if (!previewStage || !uploadedImage) return undefined;

    const handleWheel = (event) => {
    event.preventDefault();
      event.stopPropagation();
    const delta = event.deltaY > 0 ? -0.12 : 0.12;
    setScale((value) => Math.min(Math.max(value + delta, 0.7), 2.4));
  };

    previewStage.addEventListener('wheel', handleWheel, { passive: false });
    return () => previewStage.removeEventListener('wheel', handleWheel);
  }, [uploadedImage]);

  return (
    <section className="experiment-detail-page">
      <header className="experiment-detail-toolbar">
        <div className="experiment-detail-title">
          <Button
            className="experiment-detail-back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/workspace/student/experiments')}
            aria-label="返回实验列表"
          />
          <div>
            <h1>{experiment.name}</h1>
            <span className={`experiment-status-tag is-${status.tone}`}>
              <i aria-hidden="true" />
              {status.label}
            </span>
          </div>
        </div>
        <div className="experiment-detail-actions">
          <Button icon={<SaveOutlined />} onClick={handleSave}>
            保存
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit}>
            提交
          </Button>
          <Button className="pro-fill-button" icon={<CrownOutlined />}>
            一键提交<span className="pro-fill-badge">(Pro)</span>
          </Button>
        </div>
      </header>

      <SectionShell {...sectionCopy.fixed} locked>
        <LockedContent items={experiment.fixedFields.map((field) => field.label)} />
      </SectionShell>

      <SectionShell {...sectionCopy.data}>
        <div className="experiment-data-grid">
          <div className="experiment-data-panel">
            <h3>实验数据表（原始数据）</h3>
            <div className="experiment-data-table">
              <div className="experiment-data-row is-head">
                <span>序号</span>
                <span>物距/cm</span>
                <span>像距/cm</span>
                <span>焦距/cm</span>
              </div>
              {dataRows.map((row) => (
                <div className="experiment-data-row" key={row.index}>
                  <span>{row.index}</span>
                  <Input defaultValue={row.distance} />
                  <Input placeholder="请输入" defaultValue={row.imageDistance} />
                  <Input placeholder="请输入" defaultValue={row.focalDistance} />
                </div>
              ))}
            </div>
            <div className="experiment-field-grid">
              <Form.Item label="平均焦距">
                <InputNumber value={10.0} addonAfter="cm" />
              </Form.Item>
              <Form.Item label="实验误差">
                <Input value="±0.1" addonAfter="cm" />
              </Form.Item>
            </div>
          </div>

          <div className="experiment-image-panel">
            <div className="experiment-image-head">
              <h3>对应图片</h3>
              <div className="image-toolbar">
                <Button icon={<ZoomInOutlined />} onClick={() => setScale((value) => Math.min(value + 0.15, 2.4))}>
                  放大
                </Button>
                <Button icon={<ZoomOutOutlined />} onClick={() => setScale((value) => Math.max(value - 0.15, 0.7))}>
                  缩小
                </Button>
                <Button icon={<ReloadOutlined />} onClick={() => {
                  setScale(1);
                  setOffset({ x: 0, y: 0 });
                }}>
                  重置位置
                </Button>
              </div>
            </div>
            {uploadedImage ? (
              <div
                ref={previewStageRef}
                className="image-preview-stage"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={stopDragging}
                onMouseLeave={stopDragging}
              >
                <img
                  alt="实验图片预览"
                  src={uploadedImage}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                  draggable={false}
                />
              </div>
            ) : (
              <Upload.Dragger
                accept="image/*"
                beforeUpload={handleBeforeUpload}
                showUploadList={false}
              >
                <div className="image-upload-empty">
                  <CloudUploadOutlined />
                  <strong>拖动文件到这里上传实验图片</strong>
                    <span>可拖动或用鼠标滚轮缩放来对比信息</span>
                </div>
              </Upload.Dragger>
            )}
            <div className="image-action-row">
              <Button className="recognize-primary-button" type="primary" icon={<RecognizeIcon />}>
                一键识别 (Plus/Pro)
              </Button>
              <Upload accept="image/*" beforeUpload={handleBeforeUpload} showUploadList={false}>
                <Button icon={<CloudUploadOutlined />}>重新上传</Button>
              </Upload>
            </div>
            {uploadedImage && <p className="recognition-success">已识别 12 项数据，可同步到左侧表格</p>}
          </div>
        </div>
      </SectionShell>

      <SectionShell {...sectionCopy.questions} locked>
        <LockedContent items={experiment.questions.map((question) => question.label)} />
      </SectionShell>
    </section>
  );
}

function RecognizeIcon() {
  return (
    <span className="recognize-scan-icon" aria-hidden="true">
      <span className="scan-corner is-tl" />
      <span className="scan-corner is-tr" />
      <CameraOutlined />
      <span className="scan-corner is-bl" />
      <span className="scan-corner is-br" />
    </span>
  );
}

function SectionShell({ children, hint, index, locked = false, title }) {
  return (
    <section className={`experiment-edit-section${locked ? ' is-locked' : ''}`}>
      <div className="experiment-section-bar">
        <div>
          <h2>
            <span>{index}</span>
            {title}
          </h2>
          <p>{hint}</p>
        </div>
        {locked && <strong>Plus/Pro 解锁</strong>}
      </div>
      {children}
    </section>
  );
}

function LockedContent({ items }) {
  return (
    <div className="locked-content">
      <CrownOutlined />
      <strong>Plus/Pro 解锁</strong>
      <p>固定填空、实验问题辅助和权限判断需要后端校验，前端仅做展示限制。</p>
      {items.length ? (
        <div>
          {items.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
