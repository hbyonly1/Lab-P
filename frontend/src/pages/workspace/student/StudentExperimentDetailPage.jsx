import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Upload, message, Spin, Table, Popover, Tag, Space } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SendOutlined,
  CalculatorOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CameraOutlined,
  FormOutlined,
  FileZipOutlined,
  UpOutlined
} from '@ant-design/icons';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { buildExperimentConfig, initFixedValues } from '../../../services/experimentConfigStore.js';
import { AsyncJobFloatingPanel, AutomationProgressModal, GoldButton, StatusBadge } from '../../../components/ui/index.js';
import { SectionShell, ExperimentDataTable, ExperimentImageUploader, SingleImageUploadNode, ProSubmitModal } from '../../../components/experiment/index.js';

import { createSelfManagedSubmission, saveSubmissionCorrection } from '../../../services/submissionsApi.js';
import { uploadFile } from '../../../services/uploadApi.js';
import { getMe } from '../../../services/authApi.js';
import { recognizeDirect, generateAnswerDirect, getFixedFillDirect } from '../../../services/aiApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import * as submissionsApi from '../../../services/submissionsApi.js';
import {
  getSchoolExperimentDetailLatest,
  getSchoolSubmissionExperimentDetailLatest,
  getSchoolSyncSettings,
  startSchoolExperimentReportScreenshot,
  startSchoolExperimentDetailSync,
  startSchoolExperimentSubmit,
  startSchoolSubmissionExperimentReportScreenshot,
  startSchoolSubmissionExperimentDetailSync,
} from '../../../services/schoolSyncApi.js';
import { getActiveAutomationJobs, getAutomationJobScreenshotBlob } from '../../../services/automationJobsApi.js';
import { ReviewerNodeHint } from '../../../components/experiment/ReviewerNodeHint.jsx';
import { submitOneClickExperimentBatch } from '../../../utils/oneClickSubmitUtils.js';
import { generateComputedImageAssets } from '../../../utils/computedAssetsUtils.js';
import { getApiErrorMessage } from '../../../utils/apiErrorUtils.js';
import { formatStudentTaskTitle, resolveStudentNo } from '../../../utils/studentDisplayUtils.js';
import { useAsyncTaskRunner } from '../../../hooks/useAsyncTaskRunner.js';
import { useWorkspaceAsyncTaskRunner } from '../../../hooks/AsyncTaskRunnerContext.jsx';
import { ASYNC_TASK_PROGRESS_PROFILES, getAsyncTaskProgressStage } from '../../../hooks/asyncTaskProgressProfiles.js';
import { useSubmissionDraftAutosave } from '../../../hooks/useSubmissionDraftAutosave.js';
import { imageUrlToFile } from '../../../components/experiment/ExperimentImageUploader.jsx';

// Extracted components are imported from components/experiment/index.js

const OSCILLOSCOPE_EXPERIMENT_ID = 'exp_oscilloscope';
const IMAGE_COMPRESSOR_EXPERIMENT_IDS = new Set([
  OSCILLOSCOPE_EXPERIMENT_ID,
  'exp_liquid_crystal_0625',
]);
const SCHOOL_REPORT_TARGET_BYTES = 18 * 1024 * 1024;
const MIN_COMPRESSED_IMAGE_BYTES = 650 * 1024;
const MAX_COMPRESSED_IMAGE_BYTES = 3 * 1024 * 1024;

const normalizedPlan = (plan) => String(plan || 'free').trim().toLowerCase();
const canUseImageRecognitionByPlan = (plan, isInternalUser) => (
  isInternalUser || ['plus', 'pro'].includes(normalizedPlan(plan))
);
const canUseFormulaComputeByPlan = canUseImageRecognitionByPlan;
const canUseFixedFillByPlan = (plan, isInternalUser) => (
  isInternalUser || normalizedPlan(plan) === 'pro'
);

const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('图片压缩失败'));
  }, type, quality);
});

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
};

async function compressImageFile(file, targetBytes) {
  if (!(file instanceof Blob)) {
    throw new Error('图片文件格式不可压缩，请重新上传该图片后再试');
  }
  if (file.size <= targetBytes * 0.92) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const maxSourceSide = Math.max(sourceWidth, sourceHeight);
  let scale = Math.min(1, 2200 / maxSourceSide);
  let quality = 0.86;
  let blob = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= targetBytes) break;

    if (quality > 0.52) {
      quality = Math.max(0.46, quality - 0.1);
    } else {
      scale = Math.max(0.35, scale * 0.82);
    }
  }

  bitmap.close?.();

  const baseName = file.name?.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${baseName}-compressed.jpg`, { type: 'image/jpeg' });
}

async function resolveCompressSourceFile(item, fallbackName) {
  const candidates = [
    item?.originFileObj,
    item?.originFileObj?.originFileObj,
    item?.file,
    item?.file?.originFileObj,
  ];
  const blob = candidates.find((candidate) => candidate instanceof Blob);
  if (blob) {
    return blob instanceof File
      ? blob
      : new File([blob], fallbackName, { type: blob.type || 'image/png' });
  }
  if (item?.url) {
    return imageUrlToFile(item, fallbackName);
  }
  throw new Error('图片文件不可读取，请重新上传该图片后再压缩');
}

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

const normalizeInitialImageSlots = (rawSlots = {}) => {
  const normalized = {};
  Object.entries(rawSlots || {}).forEach(([slotId, rawItems]) => {
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    const files = items
      .map((item, index) => {
        if (typeof item === 'string') {
          const url = item.trim();
          return url ? { uid: `init-slot-${slotId}-${index}`, name: `User Upload ${index + 1}`, url } : null;
        }
        if (!item || !item.url) return null;
        return {
          uid: item.uid || `init-slot-${slotId}-${index}`,
          name: item.name || `User Upload ${index + 1}`,
          ...item,
        };
      })
      .filter(Boolean);
    if (files.length) normalized[slotId] = files;
  });
  return normalized;
};

const unwrapSubmissionValues = (payload) => {
  if (!payload) return {};
  if (payload.values && typeof payload.values === 'object') return payload.values;
  return payload;
};

const splitCommaSeparatedImageSources = (value) => (
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const parseSchoolImageSources = (rawValue) => {
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap(parseSchoolImageSources);
  }
  if (rawValue && typeof rawValue === 'object') {
    return parseSchoolImageSources(rawValue.url || rawValue.src || '');
  }
  const value = String(rawValue || '').trim();
  if (!value) return [];

  const dataImagePattern = /data:image\/[^,\s]+;base64,[A-Za-z0-9+/=]+/g;
  const urls = [];
  let lastIndex = 0;
  let match;
  while ((match = dataImagePattern.exec(value)) !== null) {
    urls.push(...splitCommaSeparatedImageSources(value.slice(lastIndex, match.index)));
    urls.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  urls.push(...splitCommaSeparatedImageSources(value.slice(lastIndex)));
  return urls;
};

const autosaveDisplayState = (status) => (status === 'idle' ? 'unsaved' : 'saved');

export function ExperimentDetailView({ experiment, onBack, isReviewer = false, showNodeInspector = false, initialSubmission = null, initialImagePaths = [], initialImageSlots = {}, initialFormValues = null }) {

  // 核心状态：所有的节点值都在这个 formValues 里
  const [formValues, setFormValues] = useState(() => initialFormValues || initFixedValues(experiment.inputs?.fields || []));
  const [isComputing, setIsComputing] = useState(false);
  const [isScoreChecking, setIsScoreChecking] = useState(false);
  const [scoreCheckResult, setScoreCheckResult] = useState(null);
  const [isScoreCheckModalOpen, setIsScoreCheckModalOpen] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [isGeneratingAnswers, setIsGeneratingAnswers] = useState(false);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [currentUserRole, setCurrentUserRole] = useState(isReviewer ? 'reviewer' : '');
  const [currentUser, setCurrentUser] = useState(null);
  const [status, setStatus] = useState({ label: '待处理', tone: 'pending' });
  const [latestSubmission, setLatestSubmission] = useState(initialSubmission);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSavingFinal, setIsSavingFinal] = useState(false);
  const [isCompressingImages, setIsCompressingImages] = useState(false);
  const [automationJob, setAutomationJob] = useState(null);
  const [isAutomationModalOpen, setIsAutomationModalOpen] = useState(false);
  const [detailSyncJob, setDetailSyncJob] = useState(null);
  const [isDetailSyncModalOpen, setIsDetailSyncModalOpen] = useState(false);
  const [isStartingDetailSync, setIsStartingDetailSync] = useState(false);
  const [schoolScreenshotJob, setSchoolScreenshotJob] = useState(null);
  const [isSchoolScreenshotProgressOpen, setIsSchoolScreenshotProgressOpen] = useState(false);
  const [isSchoolScreenshotModalOpen, setIsSchoolScreenshotModalOpen] = useState(false);
  const [isStartingSchoolScreenshot, setIsStartingSchoolScreenshot] = useState(false);
  const [schoolScreenshotUrl, setSchoolScreenshotUrl] = useState('');
  const [loadedSchoolScreenshotJobId, setLoadedSchoolScreenshotJobId] = useState('');
  const [isFinalConfirmOpen, setIsFinalConfirmOpen] = useState(false);
  const [appliedDetailSyncJobId, setAppliedDetailSyncJobId] = useState(null);
  const [backToTopBottom, setBackToTopBottom] = useState(82);
  const isInternalUser = isReviewer || ['admin', 'reviewer'].includes(currentUserRole);
  const {
    jobs: floatingJobs,
    startJob,
    finishJob,
    failJob,
    dismissJob,
    clearFinishedJobs,
    runCeleryTask,
    runAutomationJob,
  } = useAsyncTaskRunner();
  const workspaceTaskRunner = useWorkspaceAsyncTaskRunner();
  const workspaceRunAutomationJob = workspaceTaskRunner?.runAutomationJob;

  const submitAutomationSteps = useMemo(() => [
    'school.submit.saving',
    'school.submit.connecting',
    'school.submit.opening',
    'school.submit.filling',
    'school.submit.verifying',
    'school.submit.submitAction',
    'school.submit.confirming',
    'school.submit.readingStatus',
    'school.submit.updatingPlatform',
  ], []);

  useEffect(() => {
    const updateBackToTopPosition = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

      const floatingPanel = document.querySelector('.experiment-detail-page .async-job-floating-panel');
      if (floatingPanel) {
        const panelRect = floatingPanel.getBoundingClientRect();
        const nextBottom = Math.max(74, Math.round(viewportHeight - panelRect.top + 12));
        setBackToTopBottom(nextBottom);
      } else {
        setBackToTopBottom(82);
      }
    };

    updateBackToTopPosition();
    window.addEventListener('scroll', updateBackToTopPosition, { passive: true });
    window.addEventListener('resize', updateBackToTopPosition);
    const mutationObserver = new MutationObserver(updateBackToTopPosition);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateBackToTopPosition)
      : null;
    resizeObserver?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', updateBackToTopPosition);
      window.removeEventListener('resize', updateBackToTopPosition);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
    };
  }, []);

  const handleBackToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const trackSchoolSubmitJobInFloatingPanel = useCallback((job) => {
    if (!job?.jobId) return;
    const startAutomationJob = workspaceRunAutomationJob || runAutomationJob;
    const studentNo = resolveStudentNo(
      job,
      latestSubmission,
      initialSubmission,
      currentUser,
      job?.requestPayload,
      job?.request_payload,
    );
    const title = formatStudentTaskTitle(studentNo, '提交', experiment.meta.name);
    void startAutomationJob({
      job,
      jobKey: `school-submit-${job.jobId}`,
      title,
      description: job.action === 'final_submit' ? '正在后台执行正式提交' : '正在后台执行临时提交',
      steps: submitAutomationSteps,
      successMessage: job.action === 'final_submit' ? '正式提交完成，学校系统已更新。' : '临时提交完成，学校系统已更新。',
      failureMessage: '学校系统提交失败。',
      onSuccess: (finishedJob) => {
        setStatus(finishedJob.action === 'final_submit'
          ? { label: '正式提交完成', tone: 'green' }
          : { label: '已临时提交', tone: 'blue' });
      },
      onFailure: () => {
        setStatus({ label: '提交失败', tone: 'red' });
      },
    }).catch(() => null);
  }, [currentUser, experiment.meta.name, initialSubmission, latestSubmission, runAutomationJob, submitAutomationSteps, workspaceRunAutomationJob]);

  const showDetailSyncJob = useCallback((job) => {
    if (['draft_submit', 'final_submit'].includes(job.action)) {
      if (isInternalUser) {
        trackSchoolSubmitJobInFloatingPanel(job);
        return;
      }
      setAutomationJob(job);
      setIsAutomationModalOpen(true);
    } else {
      setDetailSyncJob(job);
      setIsDetailSyncModalOpen(true);
    }
  }, [isInternalUser, trackSchoolSubmitJobInFloatingPanel]);

  const startDetailSyncJob = useCallback(async () => {
    if (isInternalUser && initialSubmission?.id) {
      return startSchoolSubmissionExperimentDetailSync(experiment.meta.id, initialSubmission.id);
    }
    return startSchoolExperimentDetailSync(experiment.meta.id);
  }, [experiment.meta.id, initialSubmission?.id, isInternalUser]);

  const handleLoadSchoolDetail = useCallback(async () => {
    setIsStartingDetailSync(true);
    try {
      const job = await startDetailSyncJob();
      showDetailSyncJob(job);
    } catch (err) {
      const activeJob = err.response?.data?.detail?.job;
      if (err.response?.status === 409 && activeJob) {
        showDetailSyncJob(activeJob);
      } else {
        message.error(err.response?.data?.detail || '学校数据加载任务启动失败');
      }
    } finally {
      setIsStartingDetailSync(false);
    }
  }, [showDetailSyncJob, startDetailSyncJob]);

  const startSchoolScreenshotJob = useCallback(async () => {
    if (isInternalUser && initialSubmission?.id) {
      return startSchoolSubmissionExperimentReportScreenshot(experiment.meta.id, initialSubmission.id);
    }
    return startSchoolExperimentReportScreenshot(experiment.meta.id);
  }, [experiment.meta.id, initialSubmission?.id, isInternalUser]);

  const showSchoolScreenshotJob = useCallback((job) => {
    setSchoolScreenshotJob(job);
    setIsSchoolScreenshotProgressOpen(true);
  }, []);

  const loadSchoolScreenshot = useCallback(async (job) => {
    if (!job?.jobId || job.jobId === loadedSchoolScreenshotJobId) return;
    try {
      const blob = await getAutomationJobScreenshotBlob(job.jobId);
      const objectUrl = URL.createObjectURL(blob);
      setSchoolScreenshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      setLoadedSchoolScreenshotJobId(job.jobId);
      setIsSchoolScreenshotProgressOpen(false);
      setIsSchoolScreenshotModalOpen(true);
    } catch (err) {
      message.error(err.response?.data?.detail || err.message || '系统提交情况截图加载失败');
    }
  }, [loadedSchoolScreenshotJobId]);

  const handleViewSchoolScreenshot = useCallback(async () => {
    setIsStartingSchoolScreenshot(true);
    try {
      const job = await startSchoolScreenshotJob();
      showSchoolScreenshotJob(job);
      if (job.status === 'succeeded') {
        await loadSchoolScreenshot(job);
      }
    } catch (err) {
      const activeJob = err.response?.data?.detail?.job;
      if (err.response?.status === 409 && activeJob) {
        if (activeJob.action === 'school_report_screenshot') {
          showSchoolScreenshotJob(activeJob);
        } else {
          showDetailSyncJob(activeJob);
          message.warning('已有学校系统任务正在执行，请等待当前任务完成后再查看截图。');
        }
      } else {
        message.error(err.response?.data?.detail || '系统提交情况截图任务启动失败');
      }
    } finally {
      setIsStartingSchoolScreenshot(false);
    }
  }, [loadSchoolScreenshot, showDetailSyncJob, showSchoolScreenshotJob, startSchoolScreenshotJob]);

  useEffect(() => () => {
    if (schoolScreenshotUrl) URL.revokeObjectURL(schoolScreenshotUrl);
  }, [schoolScreenshotUrl]);

  useEffect(() => {
    const fetchUserProfile = async () => {
      try {
        const data = await getMe();
        setCurrentUser(data);
        setCurrentUserRole(data.role || '');
        setCurrentPlan(data.role === 'student' ? (data.capabilities?.plan || 'free') : 'internal');
      } catch (err) {
        // ignore
      }
    };
    const fetchStatus = async () => {
      try {
        const submissions = await submissionsApi.getMySubmissions();
        const experimentSubmissions = submissions
          .filter(s => s.experiment_id === experiment.meta.id)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const latest = experimentSubmissions.find(s => !s.is_one_click_handoff) || experimentSubmissions[0];
        if (latest) {
          setLatestSubmission(latest);
          const savedValues = unwrapSubmissionValues(latest.corrected_json);
          if (Object.keys(savedValues || {}).length > 0) {
            setFormValues((prev) => ({ ...prev, ...savedValues }));
          }
          const statusMap = {
            'pending_payment': { label: '待支付', tone: 'amber' },
            'incomplete': { label: '未完成', tone: 'pending' },
            'draft_submitted': { label: '已临时提交', tone: 'blue' },
            'recognizing': { label: '处理中', tone: 'blue' },
            'reviewing': { label: '审核中', tone: 'amber' },
            'submitting': { label: '提交中', tone: 'blue' },
            'completed': { label: '正式提交完成', tone: 'green' },
            'error': { label: '失败', tone: 'red' },
          };
          setStatus(statusMap[latest.status] || { label: latest.status, tone: 'default' });
        }
      } catch (err) {
        // ignore
      }
    };
    fetchUserProfile();
    fetchStatus();
    setAppliedDetailSyncJobId(null);
  }, [experiment.meta.id]);

  useEffect(() => {
    if (!currentUserRole) return undefined;
    let cancelled = false;

    const recoverOrStartDetailSync = async () => {
      try {
        const settings = await getSchoolSyncSettings();
        if (cancelled || !settings?.autoLoadDetail) return;
        if (isInternalUser && initialSubmission?.id) {
          const job = await startDetailSyncJob();
          if (!cancelled) showDetailSyncJob(job);
          return;
        }
        const activeJobs = await getActiveAutomationJobs({ experiment_id: experiment.meta.id });
        if (cancelled) return;
        const activeJob = (activeJobs || []).find((job) => (
          ['school_detail_sync', 'draft_submit', 'final_submit'].includes(job.action)
        ));
        if (activeJob) {
          showDetailSyncJob(activeJob);
          return;
        }
        const job = await startDetailSyncJob();
        if (!cancelled) showDetailSyncJob(job);
      } catch (err) {
        if (cancelled) return;
        const activeJob = err.response?.data?.detail?.job;
        if (err.response?.status === 409 && activeJob) {
          showDetailSyncJob(activeJob);
        } else {
          console.error('Failed to sync school experiment detail:', err);
        }
      }
    };

    recoverOrStartDetailSync();
    return () => {
      cancelled = true;
    };
  }, [currentUserRole, experiment.meta.id, initialSubmission?.id, isInternalUser, showDetailSyncJob, startDetailSyncJob]);

  // 图片槽位状态映射：{ "IMG_RAW": [file1, file2], "IMG_WAVE": [file3] }
  const [imageSlots, setImageSlots] = useState(() => {
    const slots = normalizeInitialImageSlots(initialImageSlots);
    if (Object.keys(slots).length > 0) return slots;
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
    const imageSlotDefs = experiment.inputs?.images || [];
    if (!imageSlotDefs.length) return;
    const imageValues = {};
    imageSlotDefs.forEach((slotDef) => {
      if (!slotDef.targetNodeId) return;
      const urls = (imageSlots[slotDef.id] || []).map((file) => file.url).filter(Boolean);
      if (urls.length) imageValues[slotDef.targetNodeId] = urls.join(',');
    });
    if (Object.keys(imageValues).length) {
      setFormValues((prev) => ({ ...prev, ...imageValues }));
    }
  }, []);

  useEffect(() => {
    if (computeMissingNodeIds.size === 0) return;
    const firstNodeId = Array.from(computeMissingNodeIds)[0];
    const escapedNodeId = window.CSS?.escape ? window.CSS.escape(firstNodeId) : firstNodeId.replace(/["\\]/g, '\\$&');
    window.setTimeout(() => {
      const target = document.querySelector(`[data-node-id="${escapedNodeId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }, 0);
  }, [computeMissingNodeIds]);

  const jumpToScoreCheckNode = (record) => {
    const targetNodeIds = record.missingNodeIds?.length
      ? record.missingNodeIds
      : (record.nodeIds || []);
    if (!targetNodeIds.length) {
      message.info('当前检查项没有可定位的节点');
      return;
    }
    setComputeMissingNodeIds(new Set(targetNodeIds));
    setIsScoreCheckModalOpen(false);
    const firstNodeId = targetNodeIds[0];
    const escapedNodeId = window.CSS?.escape ? window.CSS.escape(firstNodeId) : firstNodeId.replace(/["\\]/g, '\\$&');
    window.setTimeout(() => {
      const target = document.querySelector(`[data-node-id="${escapedNodeId}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      target?.focus?.({ preventScroll: true });
    }, 120);
  };

  const handleFieldChange = (nodeId, value) => {
    setFormValues(prev => {
      const next = { ...prev, [nodeId]: value };
      scheduleDraftSave(next, imageSlots);
      return next;
    });
    setComputeMissingNodeIds(prev => {
      if (!prev.has(nodeId)) return prev;
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
  };

  const applyLatestSchoolDetailSnapshot = async (job) => {
    if (!job?.jobId || job.jobId === appliedDetailSyncJobId) return;
    try {
      const latest = isInternalUser && initialSubmission?.id
        ? await getSchoolSubmissionExperimentDetailLatest(experiment.meta.id, initialSubmission.id)
        : await getSchoolExperimentDetailLatest(experiment.meta.id);
      const schoolFormValues = latest.formValues || {};
      const nextValues = Object.fromEntries(
        Object.entries(schoolFormValues).filter(([, value]) => value !== null && value !== undefined && String(value) !== ''),
      );
      const imageSlotDefs = experiment.inputs?.images || [];
      const nextImageSlots = {};
      imageSlotDefs.forEach((slotDef) => {
        const targetNodeId = slotDef.targetNodeId;
        if (!targetNodeId || !(targetNodeId in schoolFormValues)) return;
        const rawValue = schoolFormValues[targetNodeId];
        const urls = parseSchoolImageSources(rawValue);
        nextValues[targetNodeId] = urls.join(',');
        nextImageSlots[slotDef.id] = urls.map((url, index) => ({
          uid: `school-sync-${targetNodeId}-${index}`,
          name: `学校系统图片 ${index + 1}`,
          url,
        }));
      });
      if (Object.keys(nextImageSlots).length) {
        setImageSlots((prev) => ({ ...prev, ...nextImageSlots }));
      }
      if (Object.keys(nextValues).length === 0) {
        setAppliedDetailSyncJobId(job.jobId);
        return;
      }
      setFormValues((prev) => ({ ...prev, ...nextValues }));
      setAppliedDetailSyncJobId(job.jobId);
      message.success('学校系统数据已加载到当前页面。');
    } catch (err) {
      message.warning(`学校数据已同步，但加载到页面失败: ${err.response?.data?.detail || err.message}`);
    }
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
      const nextSlots = {
        ...prev,
        [slotId]: nextSlotFiles,
      };
      if (slotDef?.targetNodeId) {
        setFormValues(current => {
          const nextValues = {
            ...current,
            [slotDef.targetNodeId]: nextSlotFiles.map(file => file.url).filter(Boolean).join(','),
          };
          scheduleDraftSave(nextValues, nextSlots);
          return nextValues;
        });
      } else {
        scheduleDraftSave(formValues, nextSlots);
      }
      return nextSlots;
    });
  };

  const replaceImageInSlot = async (slotId, uid, file) => {
    try {
      message.loading({ content: '正在旋转并上传图片...', key: 'rotate-image' });
      const res = await uploadFile(file);
      const slotDef = (experiment.inputs?.images || []).find(s => s.id === slotId);
      setImageSlots(prev => {
        const nextSlotFiles = (prev[slotId] || []).map(item => (
          item.uid === uid
            ? { ...item, name: file.name, url: res.url, originFileObj: file }
            : item
        ));
        const nextSlots = {
          ...prev,
          [slotId]: nextSlotFiles,
        };
        if (slotDef?.targetNodeId) {
          setFormValues(current => {
            const nextValues = {
              ...current,
              [slotDef.targetNodeId]: nextSlotFiles.map(item => item.url).filter(Boolean).join(','),
            };
            scheduleDraftSave(nextValues, nextSlots);
            return nextValues;
          });
        } else {
          scheduleDraftSave(formValues, nextSlots);
        }
        return nextSlots;
      });
      message.success({ content: '图片已旋转并保存', key: 'rotate-image' });
      return true;
    } catch (e) {
      message.error({ content: `旋转失败: ${e.message}`, key: 'rotate-image' });
      return false;
    }
  };

  const handleCompressExperimentImages = async () => {
    const replacementKey = (slotId, item, index) => `${slotId}::${item?.uid || item?.url || index}`;
    const entries = Object.entries(imageSlots || {}).flatMap(([slotId, files = []]) => (
      files.map((item, index) => ({ slotId, item, index }))
    )).filter(({ item }) => item?.url || item?.originFileObj);

    if (!entries.length) {
      message.info('当前没有可压缩的图片');
      return;
    }

    setIsCompressingImages(true);
    message.loading({ content: '正在压缩图片...', key: 'compress-images', duration: 0 });

    try {
      const sourceFiles = [];
      let originalBytes = 0;
      for (const entry of entries) {
        const sourceFile = await resolveCompressSourceFile(entry.item, entry.item.name || `experiment-${entry.index + 1}.png`);
        sourceFiles.push({ ...entry, sourceFile });
        originalBytes += sourceFile.size || 0;
      }

      const targetBytesPerImage = Math.max(
        MIN_COMPRESSED_IMAGE_BYTES,
        Math.min(MAX_COMPRESSED_IMAGE_BYTES, Math.floor(SCHOOL_REPORT_TARGET_BYTES / Math.max(sourceFiles.length, 1))),
      );
      const replacements = new Map();
      let compressedBytes = 0;
      let changedCount = 0;

      for (const entry of sourceFiles) {
        const compressedFile = await compressImageFile(entry.sourceFile, targetBytesPerImage);
        compressedBytes += compressedFile.size || 0;
        if (compressedFile === entry.sourceFile) continue;

        const uploaded = await uploadFile(compressedFile);
        replacements.set(replacementKey(entry.slotId, entry.item, entry.index), {
          ...entry.item,
          name: compressedFile.name,
          url: uploaded.url,
          originFileObj: compressedFile,
          size: compressedFile.size,
        });
        changedCount += 1;
      }

      if (!changedCount) {
        message.success({
          content: `当前图片已满足压缩目标，总大小约 ${formatFileSize(originalBytes)}`,
          key: 'compress-images',
        });
        return;
      }

      const nextSlots = {};
      Object.entries(imageSlots || {}).forEach(([slotId, files = []]) => {
        nextSlots[slotId] = files.map((item, index) => replacements.get(replacementKey(slotId, item, index)) || item);
      });

      const nextValues = { ...formValues };
      (experiment.inputs?.images || []).forEach((slotDef) => {
        if (!slotDef?.targetNodeId) return;
        nextValues[slotDef.targetNodeId] = (nextSlots[slotDef.id] || [])
          .map((item) => item.url)
          .filter(Boolean)
          .join(',');
      });

      setImageSlots(nextSlots);
      setFormValues(nextValues);
      scheduleDraftSave(nextValues, nextSlots);
      message.success({
        content: `已压缩 ${changedCount} 张图片：${formatFileSize(originalBytes)} -> ${formatFileSize(compressedBytes)}`,
        key: 'compress-images',
      });
    } catch (error) {
      message.error({ content: `压缩失败：${error.message}`, key: 'compress-images' });
    } finally {
      setIsCompressingImages(false);
    }
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
          onImageReplace={replaceImageInSlot}
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
    const isAiRecognize = experiment.metaInfo?.aiRecognizeIds?.has(nodeId);
    const isAsync = experiment.metaInfo?.asyncIds?.has(nodeId);
    const isFixed = experiment.metaInfo?.fixedIds?.has(nodeId);
    const isCalcMissing = computeMissingNodeIds.has(nodeId);
    const input = (
      <input
        data-node-id={nodeId}
        className={`fixed-inline-input ${isComputed ? 'is-computed' : ''} ${isAiRecognize ? 'is-ai-recognize' : ''} ${isAsync ? 'is-async' : ''} ${isFixed ? 'is-fixed' : ''} ${isCalcMissing ? 'is-calc-missing' : ''}`}
        style={{ width: defaultWidth, margin: '0 8px', ...segmentSizeStyle(seg) }}
        placeholder={isAiRecognize ? '待识别' : isComputed ? '待计算' : ''}
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
        const nextSlots = {
          ...prev,
          [slotId]: nextSlotFiles
        };
        if (slotDef?.targetNodeId) {
          setFormValues(current => {
            const nextValues = {
              ...current,
              [slotDef.targetNodeId]: nextSlotFiles.map(item => item.url).filter(Boolean).join(','),
            };
            scheduleDraftSave(nextValues, nextSlots);
            return nextValues;
          });
        } else {
          scheduleDraftSave(formValues, nextSlots);
        }
        return nextSlots;
      });
      message.success({ content: '上传成功', key: 'upload' });
    } catch (e) {
      message.error({ content: `上传失败: ${e.message}`, key: 'upload' });
    }
    return false; // 阻止默认上传
  };

  // --- 后端计算通用接口 ---
  const handleCompute = async () => {
    if (!canUseFormulaComputeByPlan(currentPlan, isInternalUser)) {
      message.warning(`当前套餐 (${currentPlan}) 不支持一键计算数据，请升级至 Plus 或 Pro。`);
      return;
    }
    const jobId = `compute-${experiment.meta.id}`;
    const progressStage = getAsyncTaskProgressStage(ASYNC_TASK_PROGRESS_PROFILES.formulaCompute, 0);
    setIsComputing(true);
    setComputeMissingNodeIds(new Set());
    startJob(jobId, {
      title: '一键计算数据',
      description: '正在读取已填写数据并执行后端公式推导。',
      message: progressStage?.message || '正在计算实验数据...',
      percent: progressStage?.percent || 35,
    });
    try {
      const res = await experimentsApi.computeExperimentData(experiment.meta.id, formValues, latestSubmission?.id || null);
      const computedValues = res.computed_values || {};
      const changedCount = Object.entries(computedValues).filter(([nodeId, value]) => {
        const before = formValues[nodeId];
        const normalize = (raw) => (raw === null || raw === undefined ? '' : String(raw));
        return normalize(before) !== normalize(value);
      }).length;
      let nextValues = { ...formValues, ...computedValues };
      let nextSlots = imageSlots;
      const generatedAssets = await generateComputedImageAssets({ experiment, values: nextValues });
      for (const asset of generatedAssets) {
        if (!asset.imageSlotId || !asset.targetNodeId) continue;
        const uploaded = await uploadFile(asset.file);
        const fileEntry = {
          uid: `generated-${asset.targetNodeId}-${Date.now()}`,
          name: asset.file.name,
          url: uploaded.url,
          originFileObj: asset.file,
        };
        nextSlots = {
          ...nextSlots,
          [asset.imageSlotId]: [fileEntry],
        };
        nextValues = {
          ...nextValues,
          [asset.targetNodeId]: uploaded.url,
        };
      }
      if (generatedAssets.length) {
        setImageSlots(nextSlots);
      }
      setFormValues(prev => {
        const next = { ...prev, ...nextValues };
        scheduleDraftSave(next, nextSlots);
        return next;
      });
      setIsComputing(false);
      const resultParts = [];
      if (changedCount > 0) resultParts.push(`已回填 ${changedCount} 项结果`);
      if (generatedAssets.length > 0) resultParts.push(`已生成 ${generatedAssets.length} 张图片`);
      finishJob(jobId, {
        message: resultParts.length
          ? `数据计算完成，${resultParts.join('并')}，请核对。`
          : '数据计算完成，未发现需要回填的结果。',
      });
      message.success({ content: '数据计算完成！', key: 'compute' });
    } catch (e) {
      setIsComputing(false);
      const detail = e.response?.data?.detail;
      if (detail?.code === 'FORMULA_INPUT_INCOMPLETE') {
        setComputeMissingNodeIds(new Set(detail.missing_node_ids || []));
        failJob(jobId, {
          message: '填写不完整，无法计算。',
          error: '请补齐高亮字段后再重试。',
        });
        message.error({ content: '填写不完整，无法计算', key: 'compute' });
        return;
      }
      failJob(jobId, {
        message: '计算失败，请检查已填写数据。',
        error: e.response?.data?.detail || e.message,
      });
      message.error({ content: '计算失败，请检查已填写数据', key: 'compute' });
    }
  };

  const handleScoreCheck = async () => {
    setIsScoreChecking(true);
    try {
      const res = await experimentsApi.scoreCheckExperimentData(
        experiment.meta.id,
        formValues,
        latestSubmission?.id || null
      );
      setScoreCheckResult(res);
      setIsScoreCheckModalOpen(true);
      if (!res.enabled || !res.itemCount) {
        message.info('当前实验暂无可自动检查的数据规则');
      } else {
        message.success('数据合理性检查完成');
      }
    } catch (e) {
      message.error(getApiErrorMessage(e, '数据合理性检查失败'));
    } finally {
      setIsScoreChecking(false);
    }
  };

  // --- 后端自动填空接口 ---
  const handleAssistedFill = async () => {
    if (!canUseFixedFillByPlan(currentPlan, isInternalUser)) {
      message.warning(`当前套餐 (${currentPlan}) 不支持一键填空，请升级至 Pro。`);
      return;
    }
    setIsFilling(true);
    const jobId = `fixed-fill-${experiment.meta.id}`;
    try {
      await runCeleryTask({
        jobId,
        title: '一键填空',
        description: '正在读取实验固定参数并准备回填。',
        progressProfile: ASYNC_TASK_PROGRESS_PROFILES.fixedFill,
        request: () => getFixedFillDirect(experiment.meta.id, latestSubmission?.id || null),
        onSuccess: (result) => {
          setFormValues(prev => {
            const next = { ...prev };
            Object.assign(next, result);
            scheduleDraftSave(next, imageSlots);
            return next;
          });
          message.success({ content: '已填入固定配置参数，请核对！', key: 'assisted-fill' });
        },
        successMessage: (result) => `固定填空完成，已回填 ${Object.keys(result || {}).length} 项内容，请核对。`,
        failureMessage: '固定填空失败。',
      });
    } catch (e) {
      message.error({ content: e.response?.data?.detail || e.message, key: 'assisted-fill' });
    } finally {
      setIsFilling(false);
    }
  };

  // --- AI 图像识别 ---
  const handleRecognize = async () => {
    if (!canUseImageRecognitionByPlan(currentPlan, isInternalUser)) {
      message.warning(`当前套餐 (${currentPlan}) 不支持 AI 图像识别，请升级至 Plus 或 Pro。`);
      return;
    }
    const recognitionGroups = Array.isArray(experiment.ai?.recognition?.groups) && experiment.ai.recognition.groups.length
      ? experiment.ai.recognition.groups
      : [{ imageRef: experiment.ai?.recognition?.imageRef || 'IMG_RAW' }];
    const runnableGroups = recognitionGroups.map((group) => {
      const imageRef = group.imageRef;
      const currentFiles = imageSlots[imageRef] || [];
      return {
        ...group,
        imageRef,
        imagePaths: currentFiles.map(f => f.url).filter(Boolean),
      };
    });
    const missingGroups = runnableGroups
      .filter(group => group.required !== false && group.imagePaths.length === 0)
      .map(group => group.imageRef);
    if (missingGroups.length) {
      message.warning(`请先上传识别图片：${missingGroups.join('、')}`);
      return;
    }
    const groupsToRun = runnableGroups.filter(group => group.imagePaths.length > 0);
    if (!groupsToRun.length) {
      message.warning('图片未上传成功，请重新上传');
      return;
    }

    setIsRecognizing(true);
    const jobId = `recognize-${experiment.meta.id}`;
    try {
      let mergedResult = {};
      for (const [index, group] of groupsToRun.entries()) {
        await runCeleryTask({
          jobId: `${jobId}-${group.imageRef || index}`,
          title: groupsToRun.length > 1 ? `一键识别数据 ${index + 1}/${groupsToRun.length}` : '一键识别数据',
          description: `正在识别 ${group.imagePaths.length} 张实验图片。`,
          progressProfile: ASYNC_TASK_PROGRESS_PROFILES.imageRecognition,
          request: () => recognizeDirect(experiment.meta.id, group.imagePaths, latestSubmission?.id || null, group.imageRef),
          onSuccess: (result) => {
            mergedResult = {
              ...mergedResult,
              ...(result || {}),
            };
          },
          successMessage: (result) => `识别完成，已回填 ${Object.keys(result || {}).length} 项数据，请核对。`,
          failureMessage: 'AI 识别失败。',
        });
      }
      setFormValues(prev => {
        const next = {
          ...prev,
          ...mergedResult
        };
        scheduleDraftSave(next, imageSlots);
        return next;
      });
      message.success({ content: '识别完成！已自动填写数据，请核对！', key: 'recognize' });
    } catch (e) {
      message.error({ content: e.response?.data?.detail || e.message, key: 'recognize' });
    } finally {
      setIsRecognizing(false);
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

    if (!isInternalUser && currentPlan === 'free') {
      message.warning(`当前套餐 (${currentPlan}) 不支持生成式回答，请升级至 Plus 或 Pro。`);
      return;
    }

    setIsGeneratingAnswers(true);
    const jobId = `generate-answers-${experiment.meta.id}`;
    try {
      await runCeleryTask({
        jobId,
        title: '一键生成回答',
        description: `正在生成 ${questions.length} 个实验问题回答。`,
        progressProfile: ASYNC_TASK_PROGRESS_PROFILES.answerGeneration,
        request: () => generateAnswerDirect(experiment.meta.id, questions, formValues, latestSubmission?.id || null),
        onSuccess: (result) => {
          setFormValues(prev => {
            const next = { ...prev };
            (result.answers || []).forEach((item) => {
              if (item.nodeId) next[item.nodeId] = item.answer || '';
            });
            scheduleDraftSave(next, imageSlots);
            return next;
          });
          message.success({ content: '已生成并填入全部回答，请核对！', key: 'gen-answer' });
        },
        successMessage: (result) => `回答生成完成，已填入 ${(result.answers || []).length} 个回答，请核对。`,
        failureMessage: '生成回答失败。',
      });
    } catch (e) {
      message.error({ content: e.response?.data?.detail || e.message, key: 'gen-answer' });
    } finally {
      setIsGeneratingAnswers(false);
    }
  };

  const handleOneClickSubmit = () => {
    setSubmitTargets([{ ...experiment, id: experiment.meta.id, name: experiment.meta.name }]);
    setIsSubmitModalOpen(true);
  };

  const collectImagePaths = () => Object.values(imageSlots).flat().map(img => img.url).filter(Boolean);

  const ensureSubmissionForSave = async () => {
    if (isReviewer && latestSubmission?.id) return latestSubmission;
    if (isReviewer) {
      throw new Error('审核任务不存在，无法保存。');
    }
    if (latestSubmission?.id && !latestSubmission.is_one_click_handoff) return latestSubmission;
    const created = await createSelfManagedSubmission(experiment.meta.id, collectImagePaths());
    setLatestSubmission(created);
    setStatus({ label: created.status === 'incomplete' ? '未完成' : created.status, tone: created.status === 'incomplete' ? 'pending' : 'default' });
    return created;
  };

  const autosaveScope = isReviewer ? 'reviewer' : (isInternalUser ? 'admin-preview' : 'student');
  const canAutosaveToServer = (isReviewer && Boolean(latestSubmission?.id)) || currentUserRole === 'student';
  const {
    status: autosaveStatus,
    scheduleSave: scheduleDraftSave,
    flush: flushDraftSave,
  } = useSubmissionDraftAutosave({
    enabled: true,
    scope: autosaveScope,
    experiment,
    submission: latestSubmission,
    formValues,
    imageSlots,
    collectImagePaths,
    ensureSubmission: ensureSubmissionForSave,
    canSaveToServer: canAutosaveToServer,
    onServerSubmissionResolved: setLatestSubmission,
    onRestore: (draft) => {
      const restoredValues = draft?.draftJson?.values || {};
      if (Object.keys(restoredValues).length) {
        setFormValues((prev) => ({ ...prev, ...restoredValues }));
      }
      if (draft?.imageSlots && Object.keys(draft.imageSlots).length) {
        setImageSlots(normalizeInitialImageSlots(draft.imageSlots));
      }
    },
  });

  const handleSaveCorrection = async (saveMode) => {
    const isFinal = saveMode === 'final';
    const setSaving = isFinal ? setIsSavingFinal : setIsSavingDraft;
    setSaving(true);
    message.loading({ content: isFinal ? '正在正式保存实验数据...' : '正在临时保存实验数据...', key: 'save-correction' });
    try {
      await flushDraftSave();
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
        imageSlots,
      );
      setLatestSubmission(saved);
      if (saved.status === 'submitting') {
        setStatus({ label: '提交中', tone: 'blue' });
      } else if (saved.status === 'incomplete') {
        setStatus({ label: '未完成', tone: 'pending' });
      }
      const job = await startSchoolExperimentSubmit(experiment.meta.id, {
        submissionId: saved.id,
        mode: isFinal ? 'final' : 'draft',
      });
      if (isInternalUser) {
        trackSchoolSubmitJobInFloatingPanel(job);
      } else {
        setAutomationJob(job);
        setIsAutomationModalOpen(true);
      }
      message.success({ content: isFinal ? '已开始正式提交到学校系统。' : '已开始临时提交到学校系统。', key: 'save-correction' });
    } catch (e) {
      message.error({ content: `保存失败: ${getApiErrorMessage(e)}`, key: 'save-correction' });
    } finally {
      setSaving(false);
    }
  };

  const handleFinalConfirmOk = () => {
    setIsFinalConfirmOpen(false);
    handleSaveCorrection('final');
  };

  const handleModalSubmit = async (batchImages, targetStudent, isHungup = false, planName = 'pay_per_use', resolvedTargets = null, submitOptions = {}) => {
    try {
      const pageImagePaths = Object.values(imageSlots).flat().map(img => img.url).filter(Boolean);
      const { submittedCount } = await submitOneClickExperimentBatch({
        targets: resolvedTargets || submitTargets,
        batchImages,
        targetStudent,
        isHungup,
        planName,
        fallbackImagePaths: {
          [experiment.meta.id]: pageImagePaths,
        },
        ...submitOptions,
      });
      if (submittedCount === 0) {
        message.warning('请至少上传一个实验的图片');
        return;
      }
      message.success('任务已创建并提交，后台正在处理中！');
      setTimeout(() => navigate('/workspace/student'), 1500);
    } catch (e) {
      if (e.response?.status !== 403 && e.status !== 403) {
        const msg = getApiErrorMessage(e);
        message.error(`提交失败: ${msg}`);
      }
      throw e;
    }
  };

  const visibleQuestions = (experiment.ui.questions || [])
    .filter(q => experiment.metaInfo?.nodeMetaMap?.[q.nodeId]?.type !== 'image_upload');
  const recognitionImageRef = experiment.ai?.recognition?.imageRef;
  const recognitionImageSlots = (experiment.inputs?.images || [])
    .filter(slot => slot.id === recognitionImageRef || (slot.purpose !== 'answer_image' && !slot.targetNodeId));
  const showImageCompressor = IMAGE_COMPRESSOR_EXPERIMENT_IDS.has(experiment.meta?.id);
  const displayStudentNo = resolveStudentNo(latestSubmission, initialSubmission, currentUser);
  const renderNodeIdsPopover = (record) => {
    const nodeIds = record.nodeIds || [];
    const missingNodeIds = record.missingNodeIds || [];
    if (!nodeIds.length && !missingNodeIds.length) return '—';
    const visibleIds = nodeIds.length ? nodeIds : missingNodeIds;
    const content = (
      <div style={{ maxWidth: 320 }}>
        {nodeIds.length > 0 && (
          <div>
            <strong>检测节点：</strong>
            <div style={{ marginTop: 6 }}>
              <Space size={[4, 4]} wrap>
                {nodeIds.map((nodeId) => <Tag key={nodeId}>{nodeId}</Tag>)}
              </Space>
            </div>
          </div>
        )}
        {missingNodeIds.length > 0 && (
          <div style={{ marginTop: nodeIds.length ? 10 : 0 }}>
            <strong>缺失节点：</strong>
            <div style={{ marginTop: 6 }}>
              <Space size={[4, 4]} wrap>
                {missingNodeIds.map((nodeId) => <Tag color="orange" key={nodeId}>{nodeId}</Tag>)}
              </Space>
            </div>
          </div>
        )}
      </div>
    );
    return (
      <Popover content={content} trigger="hover" placement="top">
        <span style={{ display: 'inline-flex', gap: 4, maxWidth: 150, overflow: 'hidden', verticalAlign: 'middle' }}>
          <Tag style={{ margin: 0 }}>{visibleIds[0]}</Tag>
          {visibleIds.length > 1 ? <Tag style={{ margin: 0 }}>+{visibleIds.length - 1}</Tag> : null}
        </span>
      </Popover>
    );
  };
  const renderReasonWithRulePopover = (value, record) => {
    const reasonText = value || '无说明';
    const descriptions = record.ruleDescriptions || [];
    if (!descriptions.length) return reasonText;
    return (
      <span>
        {reasonText}
        <Popover
          placement="top"
          trigger="hover"
          content={(
            <div style={{ maxWidth: 360 }}>
              <strong>评分规则</strong>
              <div style={{ marginTop: 8 }}>
                {descriptions.map((item, idx) => (
                  <div key={`${record.id}-rule-${idx}`} style={{ lineHeight: 1.8 }}>{item}</div>
                ))}
              </div>
            </div>
          )}
        >
          <QuestionCircleOutlined style={{ marginLeft: 6, color: '#8c8c8c', cursor: 'help' }} />
        </Popover>
      </span>
    );
  };
  const scoreCheckColumns = [
    {
      title: '检查项',
      dataIndex: 'title',
      key: 'title',
      render: (value, record) => value || record.id,
    },
    {
      title: '结果',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      align: 'center',
      render: (status) => {
        if (status === 'full') return <StatusBadge tone="completed">满分</StatusBadge>;
        if (status === 'missing') return <StatusBadge tone="warning">缺数据</StatusBadge>;
        if (status === 'unsupported') return <StatusBadge tone="default">暂不支持</StatusBadge>;
        if (status === 'partial') return <StatusBadge tone="warning">未满分</StatusBadge>;
        return <StatusBadge tone="failed">未得分</StatusBadge>;
      },
    },
    {
      title: '得分',
      key: 'score',
      width: 120,
      align: 'center',
      render: (_, record) => `${Number(record.score || 0).toFixed(2)} / ${Number(record.maxScore || 0).toFixed(2)}`,
    },
    {
      title: '检测节点',
      key: 'nodeIds',
      width: 130,
      render: (_, record) => renderNodeIdsPopover(record),
    },
    {
      title: '说明',
      dataIndex: 'reason',
      key: 'reason',
      render: (value, record) => renderReasonWithRulePopover(value, record),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => jumpToScoreCheckNode(record)}>
          去更改
        </Button>
      ),
    },
  ];
  const referenceCheckColumns = [
    {
      title: '检查项',
      dataIndex: 'title',
      key: 'title',
      render: (value, record) => value || record.id,
    },
    {
      title: '偏差程度',
      dataIndex: 'level',
      key: 'level',
      width: 120,
      align: 'center',
      render: (level) => {
        if (level === 'good') return <StatusBadge tone="completed">正常</StatusBadge>;
        if (level === 'warning') return <StatusBadge tone="warning">偏差大</StatusBadge>;
        if (level === 'danger') return <StatusBadge tone="failed">异常</StatusBadge>;
        if (level === 'missing') return <StatusBadge tone="warning">缺数据</StatusBadge>;
        return <StatusBadge tone="pending">未判断</StatusBadge>;
      },
    },
    ...(currentUserRole === 'admin' ? [{
      title: '典型参考值',
      key: 'referenceValue',
      width: 150,
      render: (_, record) => (
        record.referenceValue === undefined || record.referenceValue === null
          ? '—'
          : `${record.referenceValue}${record.referenceUnit ? ` ${record.referenceUnit}` : ''}`
      ),
    }] : []),
    {
      title: '检测节点',
      key: 'nodeIds',
      width: 130,
      render: (_, record) => renderNodeIdsPopover(record),
    },
    {
      title: '说明',
      dataIndex: 'reason',
      key: 'reason',
      render: (value, record) => {
        const source = currentUserRole === 'admin' && record.referenceSource ? `；${record.referenceSource}` : '';
        return `${value || '无说明'}${source}`;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => jumpToScoreCheckNode(record)}>
          去更改
        </Button>
      ),
    },
  ];

  return (
    <section className="experiment-detail-page">
      <header className="experiment-detail-toolbar">
        <div className="experiment-detail-title">
          <Button className="experiment-detail-back" icon={<ArrowLeftOutlined />} onClick={onBack} />
          <div>
            <div className="experiment-detail-title-row">
              <h1>{experiment.meta.name}</h1>
              <span className={`autosave-status-pill is-${autosaveDisplayState(autosaveStatus)}`}>
                {autosaveDisplayState(autosaveStatus) === 'saved' ? '草稿已保存' : '草稿未保存'}
              </span>
            </div>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </div>
        </div>
        <div className="experiment-detail-actions">
          {showImageCompressor && (
            <Button
              icon={<FileZipOutlined />}
              style={{ background: '#fff' }}
              loading={isCompressingImages}
              onClick={handleCompressExperimentImages}
            >
              压缩图片
            </Button>
          )}
          <Button
            icon={<CameraOutlined />}
            style={{ background: '#fff' }}
            loading={isStartingSchoolScreenshot}
            onClick={handleViewSchoolScreenshot}
          >
            查看系统提交截图
          </Button>
          <Button
            icon={<ReloadOutlined />}
            style={{ background: '#fff' }}
            loading={isStartingDetailSync}
            onClick={handleLoadSchoolDetail}
          >
            加载学校数据
          </Button>
          {isInternalUser && (
            <Button
              icon={<CheckCircleOutlined />}
              style={{ background: '#fff' }}
              loading={isScoreChecking}
              onClick={handleScoreCheck}
            >
              检查数据合理性
            </Button>
          )}
          <Button icon={<SaveOutlined />} style={{ background: '#fff' }} loading={isSavingDraft} onClick={() => handleSaveCorrection('draft')}>临时提交</Button>
          <Button type="primary" icon={<SendOutlined />} loading={isSavingFinal} onClick={() => setIsFinalConfirmOpen(true)}>正式提交</Button>
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
        <div>
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
                  <div style={{ color: '#696969' }}>此实验无需填写表格。</div>
                )}
              </div>

              {/* 右侧：图片插槽与 AI */}
              <ExperimentImageUploader
                images={recognitionImageSlots}
                imageSlots={imageSlots}
                onImageUpload={handleImageUpload}
                onImageReplace={replaceImageInSlot}
                onRecognize={handleRecognize}
                isRecognizing={isRecognizing}
                canUseRecognition={canUseImageRecognitionByPlan(currentPlan, isInternalUser)}
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
        </div>

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
      <AutomationProgressModal
        open={isDetailSyncModalOpen}
        initialJob={detailSyncJob}
        title={formatStudentTaskTitle(displayStudentNo, experiment.meta.name, '学校系统实验同步')}
        steps={[
          'school.detail.connecting',
          'school.detail.opening',
          'school.detail.reading',
          'school.detail.savingSnapshot',
        ]}
        stepAliases={{
          'school.detail.syncing': 'school.detail.connecting',
        }}
        defaultMessageCode="school.detail.syncing"
        failureMessageCode="school.detail.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            applyLatestSchoolDetailSnapshot(job);
          }
        }}
        onClose={(job) => {
          if (job?.status === 'succeeded') {
            applyLatestSchoolDetailSnapshot(job);
          }
          setIsDetailSyncModalOpen(false);
        }}
      />
      <AutomationProgressModal
        open={isSchoolScreenshotProgressOpen}
        initialJob={schoolScreenshotJob}
        title={formatStudentTaskTitle(displayStudentNo, experiment.meta.name, '系统提交截图')}
        steps={[
          'school.screenshot.connecting',
          'school.screenshot.opening',
          'school.screenshot.capturing',
        ]}
        stepAliases={{
          'school.screenshot.syncing': 'school.screenshot.connecting',
        }}
        defaultMessageCode="school.screenshot.syncing"
        failureMessageCode="school.screenshot.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            loadSchoolScreenshot(job);
          }
        }}
        onClose={(job) => {
          setIsSchoolScreenshotProgressOpen(false);
          if (job?.status === 'succeeded') {
            loadSchoolScreenshot(job);
          }
        }}
      />
      <Modal
        title="系统提交情况"
        open={isSchoolScreenshotModalOpen}
        footer={null}
        width="min(1120px, 94vw)"
        onCancel={() => setIsSchoolScreenshotModalOpen(false)}
        destroyOnHidden
      >
        {schoolScreenshotUrl ? (
          <div style={{ maxHeight: '78vh', overflow: 'auto', background: '#f5f7fb', border: '1px solid #e1e7f0', borderRadius: '8px', padding: '12px' }}>
            <img
              src={schoolScreenshotUrl}
              alt="学校系统提交情况长截图"
              style={{ display: 'block', width: '100%', height: 'auto', background: '#fff' }}
            />
          </div>
        ) : (
          <div style={{ minHeight: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        )}
      </Modal>
      <Modal
        title="数据合理性检查"
        open={isScoreCheckModalOpen}
        onCancel={() => setIsScoreCheckModalOpen(false)}
        footer={null}
        width={760}
        destroyOnClose
      >
        {scoreCheckResult ? (
          <div>
            <div style={{ marginBottom: 12, color: '#4f5b67' }}>
              可检查得分：
              <strong style={{ marginLeft: 4, color: '#141413' }}>
                {Number(scoreCheckResult.score || 0).toFixed(2)} / {Number(scoreCheckResult.computableScore || 0).toFixed(2)}
              </strong>
              {scoreCheckResult.totalScore ? (
                <span style={{ marginLeft: 12 }}>实验总分：{Number(scoreCheckResult.totalScore).toFixed(2)}</span>
              ) : null}
            </div>
            {(scoreCheckResult.notes || []).length > 0 && (
              <div style={{ marginBottom: 12, color: '#8a6d3b', background: '#fff8e6', border: '1px solid #f3dfad', padding: '8px 10px', borderRadius: 6 }}>
                {scoreCheckResult.notes.join('；')}
              </div>
            )}
            <Table
              columns={scoreCheckColumns}
              dataSource={scoreCheckResult.items || []}
              rowKey="id"
              pagination={false}
              size="small"
              locale={{ emptyText: '当前实验暂未配置可自动检查的评分规则。' }}
            />
            {scoreCheckResult.referenceChecks?.enabled ? (
              <div style={{ marginTop: 18 }}>
                <div style={{ marginBottom: 8, color: '#4f5b67' }}>
                  {scoreCheckResult.referenceChecks.label || '按典型参考值检查'}
                </div>
                {(scoreCheckResult.referenceChecks.notes || []).length > 0 && (
                  <div style={{ marginBottom: 12, color: '#8a6d3b', background: '#fff8e6', border: '1px solid #f3dfad', padding: '8px 10px', borderRadius: 6 }}>
                    {scoreCheckResult.referenceChecks.notes.join('；')}
                  </div>
                )}
                <Table
                  columns={referenceCheckColumns}
                  dataSource={scoreCheckResult.referenceChecks.items || []}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  locale={{ emptyText: '当前实验暂未配置典型值检查。' }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      {/* Pro 一键提交流程弹窗 */}
      <ProSubmitModal
        open={isSubmitModalOpen}
        experiments={submitTargets}
        onCancel={() => setIsSubmitModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
      <Modal
        title="确认正式提交"
        open={isFinalConfirmOpen}
        okText="正式提交"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: true, loading: isSavingFinal }}
        onOk={handleFinalConfirmOk}
        onCancel={() => setIsFinalConfirmOpen(false)}
        destroyOnHidden
      >
        <p style={{ marginBottom: 0 }}>
          正式提交会将当前实验提交为学校系统最终状态。当前入口暂未开放，请先使用临时提交。
        </p>
      </Modal>
      <AutomationProgressModal
        open={isAutomationModalOpen}
        initialJob={automationJob}
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            setStatus(job.action === 'final_submit'
              ? { label: '正式提交完成', tone: 'green' }
              : { label: '已临时提交', tone: 'blue' });
          } else if (job.status === 'failed') {
            setStatus({ label: '提交失败', tone: 'red' });
          }
        }}
        onClose={(job) => {
          setIsAutomationModalOpen(false);
          if (job?.status === 'succeeded') {
            setStatus(job.action === 'final_submit'
              ? { label: '正式提交完成', tone: 'green' }
              : { label: '已临时提交', tone: 'blue' });
          } else if (job?.status === 'failed') {
            setStatus({ label: '提交失败', tone: 'red' });
          }
        }}
      />
      <button
        type="button"
        className="experiment-detail-back-to-top"
        aria-label="返回页面顶部"
        title="返回页面顶部"
        style={{ bottom: backToTopBottom }}
        onClick={handleBackToTop}
      >
        <UpOutlined />
      </button>
      <AsyncJobFloatingPanel
        jobs={floatingJobs}
        onDismiss={dismissJob}
        onClearDone={clearFinishedJobs}
        onRetry={(job) => {
          if (job.id.startsWith('fixed-fill-')) handleAssistedFill();
          if (job.id.startsWith('recognize-')) handleRecognize();
          if (job.id.startsWith('generate-answers-')) handleGenerateAnswers();
          if (job.id.startsWith('compute-')) handleCompute();
        }}
      />
    </section>
  );
}
