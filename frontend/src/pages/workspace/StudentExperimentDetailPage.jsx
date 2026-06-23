import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Upload, message } from 'antd';
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
import { GoldButton, LockedNotice, StatusBadge } from '../../components/ui/index.js';
import {
  getDebugServiceCapabilities,
  getDebugServiceRole,
  subscribeDebugServiceRole,
} from './debugRoleStore.js';

const dataRows = [
  { index: 1 },
  { index: 2 },
  { index: 3 },
  { index: 4 },
  { index: 5 },
];

const sectionCopy = {
  data: {
    index: '2.',
    title: '数据表格与图片识别',
  },
  fixed: {
    index: '1.',
    title: '固定填空',
  },
  questions: {
    index: '3.',
    title: '实验问题',
  },
};

export default function StudentExperimentDetailPage() {
  const { experimentId } = useParams();
  const navigate = useNavigate();
  const experiment = useMemo(
    () => experimentConfigs.find((item) => item.id === experimentId),
    [experimentId],
  );

  if (!experiment) {
    return <Navigate to="/workspace/student/experiments" replace />;
  }

  return (
    <ExperimentDetailView
      experiment={experiment}
      onBack={() => navigate('/workspace/student/experiments')}
    />
  );
}

export function ExperimentDetailView({
  experiment,
  onBack,
  onPreviewDisplayModeChange,
  previewDisplayMode = 'empty',
  previewMode = false,
}) {
  const previewStageRef = useRef(null);
  const [debugRole, setDebugRole] = useState(() => getDebugServiceRole());
  const [uploadedImages, setUploadedImages] = useState([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

  const status = statusMeta[experiment.status] ?? statusMeta.not_started;
  const debugCapabilities = getDebugServiceCapabilities(debugRole);
  const capabilities = previewMode
    ? {
      ...debugCapabilities,
      canUseAssistedFill: true,
      canUseRecognition: true,
      canUseOneClickSubmit: true,
    }
    : debugCapabilities;
  const activeImage = uploadedImages[activeImageIndex];

  const handleBeforeUpload = (file) => {
    setUploadedImages((current) => {
      if (current.length === 0) {
        setActiveImageIndex(0);
      }

      return [
        ...current,
        {
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          url: URL.createObjectURL(file),
        },
      ];
    });
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

  const handleRecognize = () => {
    if (!capabilities.canUseRecognition) {
      message.info('Plus/Pro 调试角色可使用一键识别。');
      return;
    }
    message.success('已模拟识别图片数据。');
  };

  const handleOneClickSubmit = () => {
    if (!capabilities.canUseOneClickSubmit) {
      message.info('Pro 调试角色可使用一键提交。');
      return;
    }
    message.success('已模拟一键提交实验任务。');
  };

  const handleMouseDown = (event) => {
    if (!activeImage) return;
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

  useEffect(() => subscribeDebugServiceRole(setDebugRole), []);

  useEffect(() => {
    const previewStage = previewStageRef.current;
    if (!previewStage || !activeImage) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY > 0 ? -0.12 : 0.12;
      setScale((value) => Math.min(Math.max(value + delta, 0.7), 2.4));
    };

    previewStage.addEventListener('wheel', handleWheel, { passive: false });
    return () => previewStage.removeEventListener('wheel', handleWheel);
  }, [activeImage]);

  return (
    <section className="experiment-detail-page">
      <header className="experiment-detail-toolbar">
        <div className="experiment-detail-title">
          <Button
            className="experiment-detail-back"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            aria-label="返回实验列表"
          />
          <div>
            <h1>{experiment.name}</h1>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        </div>
        <div className="experiment-detail-actions">
          {previewMode ? (
            <div className="experiment-preview-mode-group" aria-label="实验配置预览模式">
              <Button
                type={previewDisplayMode === 'empty' ? 'primary' : 'default'}
                onClick={() => onPreviewDisplayModeChange?.('empty')}
              >
                用户视角
              </Button>
              <Button
                type={previewDisplayMode === 'answer' ? 'primary' : 'default'}
                onClick={() => onPreviewDisplayModeChange?.('answer')}
              >
                填入答案
              </Button>
              <Button
                type={previewDisplayMode === 'node' ? 'primary' : 'default'}
                onClick={() => onPreviewDisplayModeChange?.('node')}
              >
                显示节点名
              </Button>
            </div>
          ) : null}
          <Button icon={<SaveOutlined />} onClick={handleSave}>
            保存
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={handleSubmit}>
            提交
          </Button>
          <GoldButton
            disabled={!capabilities.canUseOneClickSubmit}
            icon={<CrownOutlined />}
            onClick={handleOneClickSubmit}
          >
            一键提交<span className="pro-fill-badge">(Pro)</span>
          </GoldButton>
        </div>
      </header>

      <SectionShell {...sectionCopy.fixed} locked={!capabilities.canUseAssistedFill}>
        {capabilities.canUseAssistedFill ? (
          <FixedFields fields={experiment.fixedFields} displayMode={previewDisplayMode} />
        ) : (
          <LockedNotice />
        )}
      </SectionShell>

      <SectionShell {...sectionCopy.data}>
        <div className="experiment-data-grid">
          <div className="experiment-data-panel">
            <h3>{previewMode && experiment.extractFields?.length ? '识别节点预览' : '实验数据表（原始数据）'}</h3>
            {previewMode && experiment.extractFields?.length ? (
              <PreviewExtractFields fields={experiment.extractFields} displayMode={previewDisplayMode} />
            ) : (
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
                    <Input placeholder="请输入" />
                    <Input placeholder="请输入" />
                    <Input placeholder="请输入" />
                  </div>
                ))}
              </div>
            )}
            <div className="experiment-field-grid">
              <label className="experiment-unit-field">
                <span>平均焦距:</span>
                <InputNumber placeholder="请输入" />
                <span className="experiment-unit-text">cm</span>
              </label>
              <label className="experiment-unit-field">
                <span>实验误差:</span>
                <Input placeholder="请输入" />
                <span className="experiment-unit-text">cm</span>
              </label>
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
            {activeImage ? (
              <div
                ref={previewStageRef}
                className="image-preview-stage"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={stopDragging}
                onMouseLeave={stopDragging}
              >
                <img
                  alt={activeImage.name}
                  src={activeImage.url}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
                  draggable={false}
                />
              </div>
            ) : (
              <Upload.Dragger
                accept="image/*"
                beforeUpload={handleBeforeUpload}
                multiple
                showUploadList={false}
              >
                <div className="image-upload-empty">
                  <CloudUploadOutlined />
                  <strong>拖动文件到这里上传实验图片</strong>
                  <UploadSourceHint experiment={experiment} />
                </div>
              </Upload.Dragger>
            )}
            {uploadedImages.length > 0 ? (
              <div className="image-preview-list">
                {uploadedImages.map((image, index) => (
                  <Button
                    key={image.id}
                    className={index === activeImageIndex ? 'is-active' : ''}
                    onClick={() => {
                      setActiveImageIndex(index);
                      setScale(1);
                      setOffset({ x: 0, y: 0 });
                    }}
                  >
                    {image.name}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="image-action-row">
              <Button
                className="recognize-primary-button"
                disabled={!capabilities.canUseRecognition}
                type="primary"
                icon={<RecognizeIcon />}
                onClick={handleRecognize}
              >
                一键识别 (Plus/Pro)
              </Button>
              <Upload accept="image/*" beforeUpload={handleBeforeUpload} multiple showUploadList={false}>
                <Button icon={<CloudUploadOutlined />}>重新上传</Button>
              </Upload>
            </div>
            {uploadedImages.length > 0 && <p className="recognition-success">已上传 {uploadedImages.length} 张图片，可切换查看并进行识别。</p>}
          </div>
        </div>
      </SectionShell>

      <SectionShell {...sectionCopy.questions} locked={!capabilities.canUseAssistedFill}>
        {capabilities.canUseAssistedFill ? (
          <QuestionFields questions={experiment.questions} displayMode={previewDisplayMode} />
        ) : (
          <LockedNotice />
        )}
      </SectionShell>
    </section>
  );
}

function getDisplayInputProps(field, displayMode) {
  if (displayMode === 'answer') {
    return { readOnly: true, value: field.value || '' };
  }

  if (displayMode === 'node') {
    return { readOnly: true, value: field.nodeName || field.id || '' };
  }

  return {};
}

function UploadSourceHint({ experiment }) {
  if (experiment.uploadSourceGroups?.length) {
    return (
      <span className="image-source-groups">
        {experiment.uploadSourceGroups.map((group, index) => (
          <b key={`${group.join('-')}-${index}`}>
            第 {index + 1} 组：{group.join('、')}
          </b>
        ))}
      </span>
    );
  }

  if (experiment.uploadSources?.length) {
    return <span>配置图片：{experiment.uploadSources.join('、')}</span>;
  }

  return <span>可拖动或用鼠标滚轮缩放来对比信息</span>;
}

function PreviewExtractFields({ fields = [], displayMode }) {
  return (
    <div className="experiment-preview-node-table">
      <div className="experiment-preview-node-row is-head">
        <span>节点名</span>
        <span>预览值</span>
      </div>
      {fields.map((field) => (
        <div className="experiment-preview-node-row" key={field.id}>
          <span>{field.nodeName}</span>
          <Input
            placeholder={displayMode === 'node' ? '节点名' : '识别后填入'}
            {...getDisplayInputProps(field, displayMode)}
          />
        </div>
      ))}
    </div>
  );
}

function FixedFields({ displayMode, fields = [] }) {
  const normalizedFields = fields.length
    ? fields
    : [{ id: 'fixed-empty', label: '固定填空' }];

  return (
    <div className="experiment-simple-form-grid">
      {normalizedFields.map((field) => (
        <label className="experiment-simple-field" key={field.id}>
          <span>{field.label}</span>
          <Input placeholder="请输入" {...getDisplayInputProps(field, displayMode)} />
          {field.valueFromFn ? (
            <small>计算来源：{field.valueFromFn}</small>
          ) : null}
        </label>
      ))}
    </div>
  );
}

function QuestionFields({ displayMode, questions = [] }) {
  const normalizedQuestions = questions.length
    ? questions
    : [{ id: 'question-empty', label: '实验问题' }];

  return (
    <div className="experiment-simple-form-grid">
      {normalizedQuestions.map((question) => (
        <label className="experiment-simple-field" key={question.id}>
          <span>{question.label}</span>
          <Input.TextArea
            placeholder="请输入"
            rows={3}
            showCount
            maxLength={300}
            {...getDisplayInputProps(question, displayMode)}
          />
        </label>
      ))}
    </div>
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
          {hint && <p>{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
