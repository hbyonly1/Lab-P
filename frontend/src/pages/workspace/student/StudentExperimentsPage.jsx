import { useMemo, useState, useEffect } from 'react';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { message, Modal, Spin } from 'antd';
import { AutomationProgressModal, GoldButton, OutlineButton, PageHeading, StatCard, StatusBadge } from '../../../components/ui/index.js';
import { ProSubmitModal } from '../../../components/experiment/index.js';
import { calculateExperimentMetrics } from '../../../utils/metricsUtils.js';

import { getMe } from '../../../services/authApi.js';
import { STATUS_META } from '../../../constants/statusEnums.js';
import { getMySubmissions } from '../../../services/submissionsApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import {
  getSchoolCompletionCheckResult,
  getSchoolOverviewLatest,
  startSchoolExperimentCompletionCheck,
  startSchoolExperimentReportScreenshot,
} from '../../../services/schoolSyncApi.js';
import { getAutomationJobScreenshotBlob } from '../../../services/automationJobsApi.js';
import { submitOneClickExperimentBatch } from '../../../utils/oneClickSubmitUtils.js';
import { applySchoolStatusToExperiments, getSchoolStatusMeta } from '../../../utils/schoolStatusUtils.js';
import {
  COMPLETION_CHECK_STEP_ALIASES,
  COMPLETION_CHECK_STEPS,
  SchoolCompletionResultModal,
} from '../../../components/school/SchoolAutomationResultModals.jsx';

export default function StudentExperimentsPage() {
  const navigate = useNavigate();
  const [mergedList, setMergedList] = useState([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    unsubmitted: 0,
    draftSubmitted: 0,
    reviewing: 0,
    completed: 0,
  });
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);
  const [completionJob, setCompletionJob] = useState(null);
  const [isCompletionProgressOpen, setIsCompletionProgressOpen] = useState(false);
  const [isCompletionResultOpen, setIsCompletionResultOpen] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [screenshotJob, setScreenshotJob] = useState(null);
  const [isScreenshotProgressOpen, setIsScreenshotProgressOpen] = useState(false);
  const [isScreenshotModalOpen, setIsScreenshotModalOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [studentNo, setStudentNo] = useState('');
  const [completionExperimentName, setCompletionExperimentName] = useState('');
  const [screenshotExperimentName, setScreenshotExperimentName] = useState('');

  const handleOneClickSubmit = (experiment) => {
    setSubmitTargets([experiment]);
    setIsSubmitModalOpen(true);
  };

  useEffect(() => () => {
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
  }, [screenshotUrl]);

  const loadData = async () => {
    try {
      const [experiments, subs, overviewLatest] = await Promise.all([
        experimentsApi.listExperiments(),
        getMySubmissions(),
        getSchoolOverviewLatest().catch(() => ({ experiments: [] })),
      ]);
      const experimentsWithSchoolStatus = applySchoolStatusToExperiments(experiments, overviewLatest);
      const { mappedList, metrics } = calculateExperimentMetrics(subs, experimentsWithSchoolStatus);

      setMergedList(mappedList);
      setMetrics(metrics);
      getMe()
        .then((data) => setStudentNo(data?.student_no || data?.studentNo || ''))
        .catch(() => setStudentNo(''));
    } catch (error) {
      console.error("Failed to fetch experiments list:", error);
      const msg = error.response?.data?.detail || error.message;
      message.error(`获取实验数据失败: ${msg}`);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleModalSubmit = async (batchImages, targetStudent, isHungup = false, planName = 'pay_per_use', resolvedTargets = null, submitOptions = {}) => {
    try {
      const { submittedCount } = await submitOneClickExperimentBatch({
        targets: resolvedTargets || submitTargets,
        batchImages,
        targetStudent,
        isHungup,
        planName,
        ...submitOptions,
      });

      if (submittedCount === 0) {
        message.warning('请至少上传一个实验的图片');
        return;
      }

      message.success('提交成功，后台正在处理中！');
      await loadData();
    } catch (error) {
      if (error.response?.status !== 403 && error.status !== 403) {
        const msg = error.response?.data?.detail || error.message;
        message.error(`提交失败: ${msg}`);
      }
      throw error;
    }
  };

  const loadCompletionResult = async (job = completionJob) => {
    if (!job?.jobId) return;
    setCompletionLoading(true);
    try {
      const result = await getSchoolCompletionCheckResult(job.jobId);
      setCompletionResult(result);
      setIsCompletionProgressOpen(false);
      setIsCompletionResultOpen(true);
    } catch (error) {
      message.error(error.response?.data?.detail || error.message || '读取完整性检查结果失败');
    } finally {
      setCompletionLoading(false);
    }
  };

  const handleCheckCurrentCompletion = async (experiment) => {
    setCompletionResult(null);
    setCompletionExperimentName(experiment.name || '');
    setCompletionLoading(true);
    try {
      const job = await startSchoolExperimentCompletionCheck(experiment.id);
      setCompletionJob(job);
      setIsCompletionProgressOpen(true);
      if (job.status === 'succeeded') {
        await loadCompletionResult(job);
      }
    } catch (error) {
      const activeJob = error.response?.data?.detail?.job;
      if (error.response?.status === 409 && activeJob) {
        setCompletionJob(activeJob);
        setIsCompletionProgressOpen(true);
        message.warning('已有学校系统任务正在执行，请等待当前任务完成。');
      } else {
        message.error(error.response?.data?.detail || error.message || '当前实验完整性检查启动失败');
      }
    } finally {
      setCompletionLoading(false);
    }
  };

  const loadCurrentScreenshot = async (job = screenshotJob) => {
    if (!job?.jobId) return;
    setScreenshotLoading(true);
    try {
      const blob = await getAutomationJobScreenshotBlob(job.jobId);
      const objectUrl = URL.createObjectURL(blob);
      setScreenshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      setIsScreenshotProgressOpen(false);
      setIsScreenshotModalOpen(true);
    } catch (error) {
      message.error(error.response?.data?.detail || error.message || '当前实验截图加载失败');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const handleViewCurrentScreenshot = async (experiment) => {
    setScreenshotExperimentName(experiment.name || '');
    setScreenshotLoading(true);
    try {
      const job = await startSchoolExperimentReportScreenshot(experiment.id);
      setScreenshotJob(job);
      setIsScreenshotProgressOpen(true);
      if (job.status === 'succeeded') {
        await loadCurrentScreenshot(job);
      }
    } catch (error) {
      const activeJob = error.response?.data?.detail?.job;
      if (error.response?.status === 409 && activeJob) {
        if (activeJob.action === 'school_report_screenshot') {
          setScreenshotJob(activeJob);
          setIsScreenshotProgressOpen(true);
        } else {
          message.warning('已有学校系统任务正在执行，请等待当前任务完成后再查看截图。');
        }
      } else {
        message.error(error.response?.data?.detail || error.message || '当前实验截图任务启动失败');
      }
    } finally {
      setScreenshotLoading(false);
    }
  };

  return (
    <section className="workspace-standard-page student-experiments-page">
      <PageHeading title="实验提交" description="查看并提交你的全部实验任务" />

      <div className="ui-stat-grid">
        <StatCard icon={<AppstoreOutlined />} label="全部实验" value={metrics.total} tone="blue" />
        <StatCard icon={<CloudUploadOutlined />} label="已临时提交" value={metrics.draftSubmitted} tone="amber" />
        <StatCard icon={<LineChartOutlined />} label="人工审核中" value={metrics.reviewing} tone="green" />
        <StatCard icon={<CheckCircleOutlined />} label="已完成" value={metrics.completed} tone="violet" />
      </div>

      <div className="experiment-list-panel">
        <div className="experiment-list-head">
          <span>实验名称</span>
          <span>学校提交状态</span>
          <span>平台处理状态</span>
          <span>操作</span>
        </div>
        <div className="experiment-list">
          {mergedList.map((experiment) => {
            const platformMeta = STATUS_META[experiment.status] || STATUS_META.incomplete;
            const schoolMeta = getSchoolStatusMeta(experiment.schoolStatus, experiment);
            return (
              <article className="experiment-row" key={experiment.id}>
                <h3>{experiment.name}</h3>
                <StatusBadge tone={schoolMeta.tone} indicator={schoolMeta.indicator}>{schoolMeta.label}</StatusBadge>
                <StatusBadge tone={platformMeta.tone}>{platformMeta.label}</StatusBadge>
                <div className="experiment-row-actions">
                  <OutlineButton
                    icon={<EyeOutlined />}
                    onClick={() => handleViewCurrentScreenshot(experiment)}
                    aria-label="查看截图"
                    title="查看截图"
                  />
                  <OutlineButton onClick={() => handleCheckCurrentCompletion(experiment)} >
                    检查完整性
                  </OutlineButton>
                  <OutlineButton onClick={() => navigate(`/workspace/student/experiments/${experiment.id}`)}>
                    编辑与提交
                  </OutlineButton>
                  <GoldButton onClick={() => handleOneClickSubmit(experiment)} icon={<CrownOutlined />}>
                    一键提交
                  </GoldButton>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <ProSubmitModal
        open={isSubmitModalOpen}
        experiments={submitTargets}
        onCancel={() => setIsSubmitModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
      <AutomationProgressModal
        open={isCompletionProgressOpen}
        initialJob={completionJob}
        title={`${studentNo || ''} ${completionExperimentName || '当前实验'} 填空完整性检查`.trim()}
        steps={COMPLETION_CHECK_STEPS}
        stepAliases={COMPLETION_CHECK_STEP_ALIASES}
        defaultMessageCode="school.completion.syncing"
        failureMessageCode="school.completion.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            loadCompletionResult(job);
          }
        }}
        onClose={(job) => {
          setIsCompletionProgressOpen(false);
          if (job?.status === 'succeeded') {
            loadCompletionResult(job);
          }
        }}
      />
      <SchoolCompletionResultModal
        open={isCompletionResultOpen}
        result={completionResult}
        loading={completionLoading}
        title={`${studentNo || ''} ${completionExperimentName || '当前实验'} 填空完整性检查`.trim()}
        onClose={() => setIsCompletionResultOpen(false)}
      />
      <AutomationProgressModal
        open={isScreenshotProgressOpen}
        initialJob={screenshotJob}
        title={`${studentNo || ''} ${screenshotExperimentName || '当前实验'} 提交截图`.trim()}
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
            loadCurrentScreenshot(job);
          }
        }}
        onClose={(job) => {
          setIsScreenshotProgressOpen(false);
          if (job?.status === 'succeeded') {
            loadCurrentScreenshot(job);
          }
        }}
      />
      <Modal
        title="当前实验系统提交截图"
        open={isScreenshotModalOpen}
        footer={null}
        width="min(1120px, 94vw)"
        onCancel={() => setIsScreenshotModalOpen(false)}
        destroyOnHidden
      >
        {screenshotUrl ? (
          <div style={{ maxHeight: '78vh', overflow: 'auto', background: '#f5f7fb', border: '1px solid #e1e7f0', borderRadius: '8px', padding: '12px' }}>
            <img
              src={screenshotUrl}
              alt="当前实验学校系统提交截图"
              style={{ display: 'block', width: '100%', height: 'auto', background: '#fff' }}
            />
          </div>
        ) : (
          <div style={{ minHeight: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin spinning={screenshotLoading} />
          </div>
        )}
      </Modal>
    </section>
  );
}
