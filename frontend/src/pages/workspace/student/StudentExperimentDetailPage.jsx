import React, { useEffect, useState } from 'react';
import { Button, Input, Upload, message, Spin } from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  SaveOutlined,
  SendOutlined,
  CalculatorOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CameraOutlined,
  FormOutlined
} from '@ant-design/icons';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { buildExperimentConfig, initFixedValues } from '../../../services/experimentConfigStore.js';
import { GoldButton, StatusBadge } from '../../../components/ui/index.js';
import { SectionShell, ExperimentDataTable, ExperimentImageUploader, SingleImageUploadNode, ProSubmitModal } from '../../../components/experiment/index.js';

import { saveSubmissionCorrection, submitExperiment } from '../../../services/submissionsApi.js';
import { uploadFile } from '../../../services/uploadApi.js';
import { getMe } from '../../../services/authApi.js';
import { recognizeDirect, generateAnswerDirect, getFixedFillDirect, getTaskStatus } from '../../../services/aiApi.js';
import { auditApi } from '../../../services/auditApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import * as submissionsApi from '../../../services/submissionsApi.js';
import { ReviewerNodeHint } from '../../../components/experiment/ReviewerNodeHint.jsx';

// Extracted components are imported from components/experiment/index.js

export default function StudentExperimentDetailPage() {
  const { experimentId } = useParams();
  const navigate = useNavigate();
  const [experiment, setExperiment] = useState(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingConfig(true);
    setConfigError(null);
    experimentsApi.getExperimentConfig(experimentId)
      .then((config) => {
        if (!cancelled) setExperiment(buildExperimentConfig(config));
      })
      .catch((err) => {
        if (!cancelled) setConfigError(err.response?.data?.detail || err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  if (isLoadingConfig) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#fafafc' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!experiment || configError) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#fafafc' }}>
        <h1 style={{ fontSize: '48px', color: '#ff4d4f', margin: '0' }}>403</h1>
        <h2 style={{ color: '#141413' }}>配置不存在</h2>
        <p style={{ color: '#696969', maxWidth: '700px', margin: '16px auto' }}>
          当前请求的实验配置不存在。若遇到此错误，请联系管理员，QQ: 1952096193。
        </p>
        <Button onClick={() => navigate('/workspace/student/experiments')}>返回列表</Button>
      </div>
    );
  }

  return (
    <ExperimentDetailView
      experiment={experiment}
      onBack={() => navigate('/workspace/student/experiments')}
    />
  );
}

export function ExperimentDetailView({ experiment, onBack, isReviewer = false, showNodeInspector = false, initialImagePaths = [], initialFormValues = null }) {

  // 核心状态：所有的节点值都在这个 formValues 里
  const [formValues, setFormValues] = useState(() => initialFormValues || initFixedValues(experiment.inputs?.fields || []));
  const [isComputing, setIsComputing] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [status, setStatus] = useState({ label: '待处理', tone: 'pending' });
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingFinal, setIsSavingFinal] = useState(false);

  useEffect(() => {
    const fetchUserPlan = async () => {
      try {
        const data = await getMe();
        setCurrentPlan(data.capabilities?.plan || 'free');
      } catch (err) {
        // ignore
      }
    };
    const fetchStatus = async () => {
      try {
        const submissions = await submissionsApi.getMySubmissions();
        const latest = submissions.filter(s => s.experiment_id === experiment.meta.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        if (latest) {
          setLatestSubmission(latest);
          const statusMap = {
            'pending_payment': { label: '待支付', tone: 'amber' },
            'recognizing': { label: '处理中', tone: 'blue' },
            'reviewing': { label: '审核中', tone: 'amber' },
            'submitting': { label: '提交中', tone: 'blue' },
            'completed': { label: '已完成', tone: 'green' },
            'error': { label: '失败', tone: 'red' },
          };
          setStatus(statusMap[latest.status] || { label: latest.status, tone: 'default' });
        }
      } catch (err) {
        // ignore
      }
    };
    fetchUserPlan();
    fetchStatus();
  }, [experiment.meta.id]);

  // 图片槽位状态映射：{ "IMG_RAW": [file1, file2], "IMG_WAVE": [file3] }
  const [imageSlots, setImageSlots] = useState(() => {
    const slots = {};
    if (initialImagePaths && initialImagePaths.length > 0) {
      // 默认将外部传入的所有图片塞入第一个可用的图片槽位（一般是原始数据）
      const firstSlotId = experiment.inputs?.images?.[0]?.id || 'IMG_RAW';
      slots[firstSlotId] = initialImagePaths.map((url, i) => ({
        uid: `init-img-${i}`,
        name: `User Upload ${i + 1}`,
        url: url
      }));
    }
    return slots;
  });
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);
  const [computeMissingNodeIds, setComputeMissingNodeIds] = useState(() => new Set());

  useEffect(() => {
    if (computeMissingNodeIds.size === 0) return;
    const firstNodeId = Array.from(computeMissingNodeIds)[0];
    const escapedNodeId = window.CSS?.escape ? window.CSS.escape(firstNodeId) : firstNodeId.replace(/["\\]/g, '\\$&');
    window.setTimeout(() => {
      const target = document.querySelector(`[data-node-id="${escapedNodeId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 0);
  }, [computeMissingNodeIds]);

  const handleFieldChange = (nodeId, value) => {
    setFormValues(prev => ({ ...prev, [nodeId]: value }));
    setComputeMissingNodeIds(prev => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  };

  const getImageSlotForNode = (nodeId) => {
    const fieldMeta = experiment.metaInfo?.nodeMetaMap?.[nodeId];
    const explicitSlotId = fieldMeta?.imageSlotId;
    const imageSlotsDef = experiment.inputs?.images || [];
    return imageSlotsDef.find(slot => slot.id === explicitSlotId)
      || imageSlotsDef.find(slot => slot.targetNodeId === nodeId)
      || null;
  };

  const removeImageFromSlot = (slotId, uid) => {
    const slotDef = (experiment.inputs?.images || []).find(s => s.id === slotId);
    setImageSlots(prev => {
      const nextSlotFiles = (prev[slotId] || []).filter(f => f.uid !== uid);
      if (slotDef?.targetNodeId) {
        setFormValues(current => ({
          ...current,
          [slotDef.targetNodeId]: nextSlotFiles.map(file => file.url).filter(Boolean).join(','),
        }));
      }
      return {
        ...prev,
        [slotId]: nextSlotFiles,
      };
    });
  };

  const segmentSizeStyle = (seg = {}) => ({
    ...(seg.style || {}),
    ...(seg.width ? { width: seg.width } : {}),
    ...(seg.width ? { minWidth: seg.width } : {}),
    ...(seg.height ? { height: seg.height } : {}),
  });

  const segmentImageStyle = (seg = {}) => ({
    ...(seg.style || {}),
    ...(seg.width ? { maxWidth: seg.width } : {}),
    ...(seg.height ? { maxHeight: seg.height } : {}),
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
  });

  const renderFixedSegment = (seg, sIdx, defaultWidth = '60px') => {
    if (typeof seg === 'string') return <span key={sIdx} style={{ whiteSpace: 'pre-wrap' }}>{seg}</span>;

    if (seg.type === 'image') {
      const imageStyle = segmentImageStyle(seg);
      if (seg.inline) {
        return (
          <img
            key={sIdx}
            src={seg.src}
            alt=""
            style={{ ...imageStyle, verticalAlign: 'middle', margin: '0 4px' }}
            draggable={false}
          />
        );
      }
      return (
        <div key={sIdx} style={{ margin: '16px 0', width: '100%', textAlign: 'center' }}>
          <img
            src={seg.src}
            alt=""
            style={{
              maxWidth: '100%',
              maxHeight: seg.height ? undefined : '400px',
              ...imageStyle,
            }}
            draggable={false}
          />
        </div>
      );
    }

    const nodeId = seg.nodeId;
    const nodeType = experiment.metaInfo?.nodeMetaMap?.[nodeId]?.type;
    const imageSlotDef = nodeType === 'image_upload' ? getImageSlotForNode(nodeId) : null;

    if (imageSlotDef) {
      return (
        <SingleImageUploadNode
          key={sIdx}
          nodeId={nodeId}
          imageSlot={imageSlotDef}
          imageSlots={imageSlots}
          onImageUpload={handleImageUpload}
          onRemoveImage={(slotId, uid) => removeImageFromSlot(slotId, uid)}
          title={seg.title}
          emptyTitle={seg.emptyTitle}
          emptyHint={seg.emptyHint}
          showNodeInspector={showNodeInspector}
          nodeMeta={experiment.metaInfo?.nodeMetaMap?.[nodeId]}
          value={formValues[nodeId]}
        />
      );
    }

    const isComputed = experiment.metaInfo?.computedIds?.has(nodeId);
    const isAsync = experiment.metaInfo?.asyncIds?.has(nodeId);
    const isFixed = experiment.metaInfo?.fixedIds?.has(nodeId);
    const isCalcMissing = computeMissingNodeIds.has(nodeId);
    const input = (
      <input
        data-node-id={nodeId}
        className={`fixed-inline-input ${isComputed ? 'is-computed' : ''} ${isAsync ? 'is-async' : ''} ${isFixed ? 'is-fixed' : ''} ${isCalcMissing ? 'is-calc-missing' : ''}`}
        style={{ width: defaultWidth, margin: '0 8px', ...segmentSizeStyle(seg) }}
        placeholder={isComputed ? '待计算' : ''}
        value={formValues[nodeId] ?? ''}
        onChange={e => handleFieldChange(nodeId, e.target.value)}
        title={showNodeInspector ? `节点: ${nodeId}` : undefined}
      />
    );

    if (!showNodeInspector) return React.cloneElement(input, { key: sIdx });

    return (
      <span key={sIdx} className="reviewer-inline-node-wrap">
        {input}
        <ReviewerNodeHint nodeId={nodeId} meta={experiment.metaInfo?.nodeMetaMap?.[nodeId]} value={formValues[nodeId]} />
      </span>
    );
  };

  const handleImageUpload = async (slotId, file) => {
    try {
      message.loading({ content: '正在上传图片...', key: 'upload' });
      const res = await uploadFile(file);
      setImageSlots(prev => {
        const currentSlotFiles = prev[slotId] || [];
        const slotDef = (experiment.inputs?.images || []).find(s => s.id === slotId);
        if (slotDef?.maxCount && currentSlotFiles.length >= slotDef.maxCount && slotDef.maxCount !== 1) {
          message.warning(`该区域最多上传 ${slotDef.maxCount} 张图片`);
          return prev;
        }
        const nextSlotFiles = slotDef?.maxCount === 1
          ? [{ ...file, url: res.url }]
          : [...currentSlotFiles, { ...file, url: res.url }];
        if (slotDef?.targetNodeId) {
          setFormValues(current => ({
            ...current,
            [slotDef.targetNodeId]: nextSlotFiles.map(item => item.url).filter(Boolean).join(','),
          }));
        }
        return {
          ...prev,
          [slotId]: nextSlotFiles
        };
      });
      message.success({ content: '上传成功', key: 'upload' });
    } catch (e) {
      message.error({ content: `上传失败: ${e.message}`, key: 'upload' });
    }
    return false; // 阻止默认上传
  };

  // --- 后端计算通用接口 ---
  const handleCompute = async () => {
    setIsComputing(true);
    setComputeMissingNodeIds(new Set());
    message.loading({ content: '正在请求计算，请耐心等待...', key: 'compute' });
    try {
      const res = await experimentsApi.computeExperimentData(experiment.meta.id, formValues);
      setFormValues(prev => ({ ...prev, ...res.computed_values }));
      setIsComputing(false);
      message.success({ content: '数据计算完成！', key: 'compute' });
    } catch (e) {
      setIsComputing(false);
      const detail = e.response?.data?.detail;
      if (detail?.code === 'FORMULA_INPUT_INCOMPLETE') {
        setComputeMissingNodeIds(new Set(detail.missing_node_ids || []));
        message.error({ content: '填写不完整，无法计算', key: 'compute' });
        return;
      }
      message.error({ content: '计算失败，请检查已填写数据', key: 'compute' });
    }
  };

  const pollTask = async (taskId, onSuccess, onError) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 30) {
        clearInterval(interval);
        onError(new Error('请求超时，请稍后重试'));
        return;
      }
      try {
        const res = await getTaskStatus(taskId);
        if (res.status === 'done') {
          clearInterval(interval);
          onSuccess(res.result);
        } else if (res.status === 'error') {
          clearInterval(interval);
          onError(new Error(res.message || '处理失败'));
        }
      } catch (err) {
        clearInterval(interval);
        onError(err);
      }
    }, 2000);
  };

  // --- 后端自动填空接口 ---
  const handleAssistedFill = async () => {
    if (!isReviewer && ['free', 'plus'].includes(currentPlan)) {
      message.warning(`当前套餐 (${currentPlan}) 不支持一键填空，请升级至 Pro。`);
      return;
    }
    setIsFilling(true);
    message.loading({ content: '正在获取固定填空配置...', key: 'assisted-fill' });
    try {
      const res = await getFixedFillDirect(experiment.meta.id);
      pollTask(res.task_id, (result) => {
        setFormValues(prev => {
          const next = { ...prev };
          Object.assign(next, result);
          return next;
        });
        setIsFilling(false);
        message.success({ content: '已填入固定配置参数，请核对！', key: 'assisted-fill' });
      }, (err) => {
        setIsFilling(false);
        message.error({ content: err.message, key: 'assisted-fill' });
      });
    } catch (e) {
      setIsFilling(false);
      message.error({ content: `获取失败: ${e.response?.data?.detail || e.message}`, key: 'assisted-fill' });
    }
  };

  // --- AI 图像识别 ---
  const handleRecognize = async () => {
    const targetSlot = experiment.ai?.recognition?.imageRef || 'IMG_RAW';
    const currentFiles = imageSlots[targetSlot] || [];
    if (!currentFiles || currentFiles.length === 0) {
      message.warning('请先在相应的区域上传图片');
      return;
    }

    const imagePaths = currentFiles.map(f => f.url).filter(Boolean);
    if (imagePaths.length === 0) {
      message.warning('图片未上传成功，请重新上传');
      return;
    }

    setIsRecognizing(true);
    message.loading({ content: '正在请求大模型，请耐心等待...', key: 'recognize' });

    try {
      const res = await recognizeDirect(experiment.meta.id, imagePaths);
      pollTask(res.task_id, (result) => {
        setFormValues(prev => ({
          ...prev,
          ...result
        }));
        setIsRecognizing(false);
        message.success({ content: '识别完成！已自动填写数据，请核对！', key: 'recognize' });
      }, (err) => {
        setIsRecognizing(false);
        message.error({ content: err.message, key: 'recognize' });
      });
    } catch (e) {
      setIsRecognizing(false);
      message.error({ content: `识别失败: ${e.response?.data?.detail || e.message}`, key: 'recognize' });
    }
  };

  // --- AI 自动生成解答 ---
  const handleGenerateAnswers = async () => {
    const questions = (experiment.ui.questions || [])
      .filter((q) => q.nodeId && experiment.metaInfo?.nodeMetaMap?.[q.nodeId]?.type !== 'image_upload')
      .map((q, idx) => ({
        index: idx + 1,
        nodeId: q.nodeId,
        title: q.title || '',
      }));

    if (questions.length === 0) {
      message.info('当前实验没有需要生成回答的问题');
      return;
    }

    if (!isReviewer && currentPlan === 'free') {
      message.warning(`当前套餐 (${currentPlan}) 不支持生成式回答，请升级至 Plus 或 Pro。`);
      return;
    }

    setIsGeneratingAnswers(true);
    message.loading({ content: '正在请求大模型，请耐心等待...', key: 'gen-answer' });
    try {
      const res = await generateAnswerDirect(experiment.meta.id, questions, formValues);
      pollTask(res.task_id, (result) => {
        setFormValues(prev => {
          const next = { ...prev };
          (result.answers || []).forEach((item) => {
            if (item.nodeId) next[item.nodeId] = item.answer || '';
          });
          return next;
        });
        setIsGeneratingAnswers(false);
        message.success({ content: '已生成并填入全部回答，请核对！', key: 'gen-answer' });
      }, (err) => {
        setIsGeneratingAnswers(false);
        message.error({ content: err.message, key: 'gen-answer' });
      });
    } catch (e) {
      setIsGeneratingAnswers(false);
      message.error({ content: `生成失败: ${e.response?.data?.detail || e.message}`, key: 'gen-answer' });
    }
  };

  const handleOneClickSubmit = () => {
    if (!isReviewer && ['free', 'plus'].includes(currentPlan)) {
      message.warning(`当前套餐 (${currentPlan}) 不支持一键提交，请升级至 Pro 或购买单次提交。`);
      return;
    }
    setSubmitTargets([{ ...experiment, id: experiment.meta.id, name: experiment.meta.name }]);
    setIsSubmitModalOpen(true);
  };

  const collectImagePaths = () => Object.values(imageSlots).flat().map(img => img.url).filter(Boolean);

  const ensureSubmissionForSave = async () => {
    if (latestSubmission?.id) return latestSubmission;
    const created = await submitExperiment(experiment.meta.id, null, true, collectImagePaths(), 'pay_per_use');
    setLatestSubmission(created);
    setStatus({ label: created.status === 'pending_payment' ? '待支付' : created.status, tone: created.status === 'pending_payment' ? 'amber' : 'default' });
    return created;
  };

  const handleSaveCorrection = async (saveMode) => {
    const isFinal = saveMode === 'final';
    const setSaving = isFinal ? setIsSavingFinal : setIsSavingDraft;
    setSaving(true);
    message.loading({ content: isFinal ? '正在正式保存实验数据...' : '正在临时保存实验数据...', key: 'save-correction' });
    try {
      const submission = await ensureSubmissionForSave();
      const saved = await saveSubmissionCorrection(
        submission.id,
        {
          values: formValues,
          experiment_id: experiment.meta.id,
          experiment_name: experiment.meta.name,
        },
        collectImagePaths(),
        saveMode,
      );
      setLatestSubmission(saved);
      message.success({ content: isFinal ? '正式数据已保存到该网站。' : '草稿已保存到该网站。', key: 'save-correction' });
    } catch (e) {
      message.error({ content: `保存失败: ${e.response?.data?.detail || e.message}`, key: 'save-correction' });
    } finally {
      setSaving(false);
    }
  };

  const handleModalSubmit = async (batchImages, targetStudent, isHungup = false, planName = 'pay_per_use') => {
    try {
      // 提取弹窗内上传的图片路径
      const expImages = batchImages[experiment.meta.id] || {};
      const modalImagePaths = Object.values(expImages).flat().map(img => img.url).filter(Boolean);
      // 提取页面上上传的图片路径
      const pageImagePaths = Object.values(imageSlots).flat().map(img => img.url).filter(Boolean);

      // 如果弹窗里有新传的图，优先用弹窗里的，否则用页面上的
      const imagePaths = modalImagePaths.length > 0 ? modalImagePaths : pageImagePaths;

      for (const target of submitTargets) {
        const newSubmission = await submitExperiment(experiment.meta.id, targetStudent, isHungup, imagePaths, planName);
      }
      message.success('任务已创建并提交，后台正在处理中！');
      setTimeout(() => navigate('/workspace/student'), 1500);
    } catch (e) {
      if (e.response?.status !== 403 && e.status !== 403) {
        const msg = e.response?.data?.detail || e.message;
        message.error(`提交失败: ${msg}`);
      }
      throw e;
    }
  };

  const visibleQuestions = (experiment.ui.questions || [])
    .filter(q => experiment.metaInfo?.nodeMetaMap?.[q.nodeId]?.type !== 'image_upload');

  return (
    <section className="experiment-detail-page">
      <header className="experiment-detail-toolbar">
        <div className="experiment-detail-title">
          <Button className="experiment-detail-back" icon={<ArrowLeftOutlined />} onClick={onBack} />
          <div>
            <h1>{experiment.meta.name}</h1>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        </div>
        <div className="experiment-detail-actions">
          <Button icon={<SaveOutlined />} style={{ background: '#fff' }} loading={isSavingDraft} onClick={() => handleSaveCorrection('draft')}>临时提交</Button>
          <Button type="primary" icon={<SendOutlined />} loading={isSavingFinal} onClick={() => handleSaveCorrection('final')}>正式提交</Button>
          <GoldButton onClick={handleOneClickSubmit} icon={<CrownOutlined />}>
            一键提交
          </GoldButton>
        </div>
      </header>

      <div className="workspace-content">
        {/* 区域 1：基础填空（混排） */}
        <SectionShell
          index="1."
          title="实验目的与实验原理"
          extra={
            <Button className="recognize-primary-button" type="primary" icon={<FormOutlined />} onClick={handleAssistedFill} loading={isFilling}>
              一键填空
            </Button>
          }
        >
          <div className="fixed-sections-grid">
            {experiment.ui.fixedSections?.map((section, idx) => (
              <div key={idx}>
                {section.title && <h3 className="fixed-section-title">{section.title}</h3>}
                <div className="fixed-section-content">
                  {section.segments.map((seg, sIdx) => renderFixedSegment(seg, sIdx, '60px'))}
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        {/* 区域 2：数据表格与图片 */}
        <SectionShell index="2." title="实验处理">
          <div className="experiment-data-grid">
            {/* 左侧：动态表格 */}
            <div className="experiment-data-wrapper">
              {(experiment.ui.dataTables?.length || experiment.ui.dataTable) ? (
                (experiment.ui.dataTables || [experiment.ui.dataTable]).map((table, idx) => (
                  <ExperimentDataTable
                    key={idx}
                    dataTable={table}
                    formValues={formValues}
                    onFieldChange={handleFieldChange}
                    metaInfo={experiment.metaInfo}
                    showNodeHints={showNodeInspector}
                    highlightedNodeIds={computeMissingNodeIds}
                  />
                ))
              ) : (
                <div style={{ color: '#696969' }}>此实验无需填写实验处理。</div>
              )}
            </div>

            {/* 右侧：图片插槽与 AI */}
            <ExperimentImageUploader
              images={(experiment.inputs?.images || []).filter(slot => slot.purpose !== 'answer_image' && !slot.targetNodeId)}
              imageSlots={imageSlots}
              onImageUpload={handleImageUpload}
              onRecognize={handleRecognize}
              isRecognizing={isRecognizing}
              canUseRecognition={true}
              recognitionDef={experiment.ai?.recognition}
              onRemoveImage={(slotId, uid) => removeImageFromSlot(slotId, uid)}
            />
          </div>

          {/* 底部附加的计算或推导板块 */}
          {experiment.ui.postDataSections?.length > 0 && (
            <div className="experiment-post-data-sections" style={{ borderTop: '1px solid #e1e7f0' }}>
              <div className="fixed-sections-grid">
                {experiment.ui.postDataSections.map((section, idx) => (
                  <div key={idx}>
                    {section.title && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ margin: 0, fontSize: '15px', color: '#141413' }}>{section.title}</h3>
                        <Button className="recognize-primary-button" type="primary" icon={<CalculatorOutlined />} onClick={handleCompute} loading={isComputing}>
                          一键计算数据
                        </Button>
                      </div>
                    )}
                    <div className="fixed-section-content">
                      {section.segments.map((seg, sIdx) => renderFixedSegment(seg, sIdx, '80px'))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionShell>

        {/* 区域 3：实验问题 */}
        <SectionShell
          index="3."
          title="实验分析与拓展"
          extra={
            <Button
              className="recognize-primary-button"
              type="primary"
              icon={<CrownOutlined />}
              loading={isGeneratingAnswers}
              onClick={handleGenerateAnswers}
            >
              一键生成并填入回答
            </Button>
          }
        >
          <div className="experiment-questions-section" style={{ background: '#fff', border: '1px solid #e1e7f0', borderRadius: '12px', padding: '24px' }}>
            {visibleQuestions.map(q => {
              const qMeta = experiment.metaInfo?.nodeMetaMap?.[q.nodeId];
              const questionContent = (
                <div className={`question-item ${showNodeInspector ? 'reviewer-question-node-shell' : ''}`} style={{ marginBottom: '24px' }}>
                <div className="reviewer-question-title-row">
                  <h4 style={{ fontSize: '15px', marginBottom: '12px', color: '#141413' }}>{q.title}</h4>
                </div>
                {showNodeInspector && (
                  <div className="reviewer-question-node-strip">
                    <span>节点</span>
                    <code>{q.nodeId}</code>
                    <span>{qMeta?.type || 'generated'}</span>
                    {qMeta?.formula && <code>{qMeta.formula}</code>}
                  </div>
                )}
                <Input.TextArea
                  className="question-textarea"
                  rows={q.rows || 4}
                  placeholder={q.placeholder}
                  value={formValues[q.nodeId] ?? ''}
                  onChange={e => handleFieldChange(q.nodeId, e.target.value)}
                  style={{ marginBottom: '12px', backgroundColor: '#fff' }}
                />
              </div>
              );

              if (!showNodeInspector) return <div key={q.nodeId}>{questionContent}</div>;

              return (
                <ReviewerNodeHint
                  key={q.nodeId}
                  nodeId={q.nodeId}
                  meta={qMeta}
                  value={formValues[q.nodeId]}
                >
                  {questionContent}
                </ReviewerNodeHint>
              );
            })}
            {visibleQuestions.length === 0 && (
              <span style={{ color: '#696969' }}>此实验无需填写实验分析与拓展。</span>
            )}
          </div>
        </SectionShell>
      </div>
      {/* Pro 一键提交流程弹窗 */}
      <ProSubmitModal
        open={isSubmitModalOpen}
        experiments={submitTargets}
        onCancel={() => setIsSubmitModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
    </section>
  );
}
