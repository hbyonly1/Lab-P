import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tooltip, message } from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  CloseCircleOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { GoldButton, OutlineButton, PageHeading, StatCard, StatusBadge, TablePanel, AutomationProgressModal } from '../../../components/ui/index.js';
import { ProSubmitModal } from '../../../components/experiment/index.js';
import { ReviewBatchImageAssignmentModal } from '../../../components/reviewer/ReviewBatchImageAssignmentModal.jsx';
import { STATUS_META } from '../../../constants/statusEnums.js';
import { getSchoolStatusMeta } from '../../../utils/schoolStatusUtils.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { previewLogin } from '../../../services/authApi.js';
import {
  captureAdminStudentSubmissionScreenshots,
  checkAdminStudentCompletion,
  createAdminStudent,
  ensureAdminStudentEditSubmission,
  finalSubmitAdminStudentDrafts,
  getAdminStudentExperiments,
  getAdminStudents,
  getAdminStudentCompletionCheckResult,
  getAdminStudentSubmissionScreenshotBlob,
  getAdminStudentSubmissionScreenshotsResult,
  syncAdminStudentOverview,
} from '../../../services/adminStudentsApi.js';
import { submitOneClickExperimentBatch } from '../../../utils/oneClickSubmitUtils.js';
import { getApiErrorMessage } from '../../../utils/apiErrorUtils.js';
import { useWorkspaceAsyncTaskRunner } from '../../../hooks/AsyncTaskRunnerContext.jsx';

function formatDateTime(value) {
  if (!value) return '暂无';
  const raw = String(value);
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? '暂无' : date.toLocaleString();
}

function experimentStatusMeta(status) {
  if (status === 'unsubmitted') {
    return { label: '未提交', tone: 'pending' };
  }
  return STATUS_META[status] || STATUS_META.incomplete;
}

const ADMIN_STUDENTS_LIST_STATE_KEY = 'admin-students:list-state';
const ADMIN_STUDENTS_LIST_STATE_TTL_MS = 30 * 60 * 1000;
const ADMIN_STUDENTS_PAGE_SIZE = 5;

const DEFAULT_STUDENT_NO_PREFIX = '26A';
const ADMIN_STUDENTS_BULK_PAGE_SIZE = 100;
const ADMIN_STUDENTS_BULK_CONCURRENCY = 5;
const ADMIN_STUDENTS_REFRESH_DEFAULT_CONCURRENCY = 2;
const ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_COUNT = 2;
const ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 30;

const COMPLETION_CHECK_STEPS = [
  'school.completion.connecting',
  'school.overview.readingList',
  'school.completion.opening',
  'school.completion.checkingExperiment',
  'school.completion.savingResult',
];
const COMPLETION_CHECK_STEP_ALIASES = {
  'school.completion.syncing': 'school.completion.connecting',
  'school.overview.syncing': 'school.completion.connecting',
  'school.overview.connecting': 'school.completion.connecting',
  'school.overview.openingLogin': 'school.completion.connecting',
  'school.overview.loggingIn': 'school.completion.connecting',
  'school.overview.checkingLogin': 'school.completion.connecting',
  'school.overview.recognizingCaptcha': 'school.completion.connecting',
  'school.overview.retryingCaptcha': 'school.completion.connecting',
};
const SUBMISSION_SCREENSHOT_STEPS = [
  'school.submissionScreenshots.connecting',
  'school.overview.readingList',
  'school.submissionScreenshots.opening',
  'school.submissionScreenshots.capturingExperiment',
  'school.submissionScreenshots.savingResult',
];
const SUBMISSION_SCREENSHOT_STEP_ALIASES = {
  'school.submissionScreenshots.syncing': 'school.submissionScreenshots.connecting',
  'school.overview.syncing': 'school.submissionScreenshots.connecting',
  'school.overview.connecting': 'school.submissionScreenshots.connecting',
  'school.overview.openingLogin': 'school.submissionScreenshots.connecting',
  'school.overview.loggingIn': 'school.submissionScreenshots.connecting',
  'school.overview.checkingLogin': 'school.submissionScreenshots.connecting',
  'school.overview.recognizingCaptcha': 'school.submissionScreenshots.connecting',
  'school.overview.retryingCaptcha': 'school.submissionScreenshots.connecting',
};
const OVERVIEW_SYNC_STEPS = [
  'school.overview.connecting',
  'school.overview.recognizingCaptcha',
  'school.overview.checkingLogin',
  'school.overview.readingList',
  'school.overview.savingSnapshot',
];
const OVERVIEW_SYNC_STEP_ALIASES = {
  'school.overview.syncing': 'school.overview.connecting',
  'school.overview.openingLogin': 'school.overview.connecting',
  'school.overview.loggingIn': 'school.overview.checkingLogin',
  'school.overview.retryingCaptcha': 'school.overview.recognizingCaptcha',
};
const FINAL_SUBMIT_DRAFTS_STEPS = [
  'school.finalSubmitDrafts.connecting',
  'school.overview.readingList',
  'school.finalSubmitDrafts.opening',
  'school.submit.submittingFinal',
  'school.submit.readingStatus',
  'school.finalSubmitDrafts.refreshing',
];
const FINAL_SUBMIT_DRAFTS_STEP_ALIASES = {
  'school.finalSubmitDrafts.syncing': 'school.finalSubmitDrafts.connecting',
  'school.overview.syncing': 'school.finalSubmitDrafts.connecting',
  'school.overview.connecting': 'school.finalSubmitDrafts.connecting',
  'school.overview.openingLogin': 'school.finalSubmitDrafts.connecting',
  'school.overview.loggingIn': 'school.finalSubmitDrafts.connecting',
  'school.overview.checkingLogin': 'school.finalSubmitDrafts.connecting',
  'school.overview.recognizingCaptcha': 'school.finalSubmitDrafts.connecting',
  'school.overview.retryingCaptcha': 'school.finalSubmitDrafts.connecting',
};

function confirmModal(options) {
  return new Promise((resolve) => {
    Modal.confirm({
      ...options,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function readAdminStudentsListState() {
  try {
    const raw = window.sessionStorage.getItem(ADMIN_STUDENTS_LIST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(ADMIN_STUDENTS_LIST_STATE_KEY);
      return null;
    }
    return {
      ...parsed,
      pagination: {
        current: parsed.pagination?.current || 1,
        pageSize: ADMIN_STUDENTS_PAGE_SIZE,
      },
    };
  } catch (error) {
    return null;
  }
}

function writeAdminStudentsListState(state) {
  try {
    window.sessionStorage.setItem(
      ADMIN_STUDENTS_LIST_STATE_KEY,
      JSON.stringify({
        ...state,
        savedAt: Date.now(),
        expiresAt: Date.now() + ADMIN_STUDENTS_LIST_STATE_TTL_MS,
      }),
    );
  } catch (error) {
    // UI state restore is best-effort only.
  }
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        results.push({ status: 'fulfilled', item, value: await worker(item) });
      } catch (error) {
        results.push({ status: 'rejected', item, reason: error });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

const sleep = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

async function runWithConcurrencyAndRateLimit(items, options, worker) {
  const queue = [...items];
  const results = [];
  const concurrency = Math.max(1, Math.min(10, Number(options.concurrency) || 1));
  const rateLimitCount = Math.max(1, Number(options.rateLimitCount) || 1);
  const rateLimitWindowMs = Math.max(1000, (Number(options.rateLimitWindowSeconds) || 1) * 1000);
  const startedAtList = [];
  const lock = { pending: Promise.resolve() };

  const waitForLaunchSlot = async () => {
    let release;
    const previous = lock.pending;
    lock.pending = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      while (true) {
        const now = Date.now();
        while (startedAtList.length && now - startedAtList[0] >= rateLimitWindowMs) {
          startedAtList.shift();
        }
        if (startedAtList.length < rateLimitCount) {
          startedAtList.push(now);
          return;
        }
        const waitMs = Math.max(250, rateLimitWindowMs - (now - startedAtList[0]));
        await sleep(waitMs);
      }
    } finally {
      release();
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await waitForLaunchSlot();
        results.push({ status: 'fulfilled', item, value: await worker(item) });
      } catch (error) {
        results.push({ status: 'rejected', item, reason: error });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export default function AdminStudentsPage() {
  const navigate = useNavigate();
  const workspaceTaskRunner = useWorkspaceAsyncTaskRunner();
  const restoredListStateRef = useRef(readAdminStudentsListState());
  const [students, setStudents] = useState([]);
  const [experiments, setExperiments] = useState([]);
  const [studentListSummary, setStudentListSummary] = useState(null);
  const [studentTotal, setStudentTotal] = useState(0);
  const [studentExperimentLoadingIds, setStudentExperimentLoadingIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bulkRefreshLoading, setBulkRefreshLoading] = useState(false);
  const [bulkFinalSubmitLoading, setBulkFinalSubmitLoading] = useState(false);
  const [bulkRefreshOpen, setBulkRefreshOpen] = useState(false);
  const [bulkRefreshForm] = Form.useForm();
  const [searchText, setSearchText] = useState(restoredListStateRef.current?.searchText || '');
  const [finalCountFilter, setFinalCountFilter] = useState(restoredListStateRef.current?.finalCountFilter || 'all');
  const [expandedRowKeys, setExpandedRowKeys] = useState(restoredListStateRef.current?.expandedRowKeys || []);
  const [pagination, setPagination] = useState(restoredListStateRef.current?.pagination || { current: 1, pageSize: ADMIN_STUDENTS_PAGE_SIZE });
  const restoredScrollYRef = useRef(Number(restoredListStateRef.current?.scrollY || 0));
  const didRestoreScrollRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addForm] = Form.useForm();
  const [syncJob, setSyncJob] = useState(null);
  const [syncStudent, setSyncStudent] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);
  const [submitStudent, setSubmitStudent] = useState(null);
  const [submitModalKey, setSubmitModalKey] = useState('');
  const submitModalKeyRef = useRef('');
  const [completionStudent, setCompletionStudent] = useState(null);
  const [completionJob, setCompletionJob] = useState(null);
  const [completionProgressOpen, setCompletionProgressOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);
  const [screenshotStudent, setScreenshotStudent] = useState(null);
  const [screenshotJob, setScreenshotJob] = useState(null);
  const [screenshotProgressOpen, setScreenshotProgressOpen] = useState(false);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotResult, setScreenshotResult] = useState(null);
  const [screenshotUrls, setScreenshotUrls] = useState({});
  const [imageMatchBatch, setImageMatchBatch] = useState(null);
  const [imageMatchStudent, setImageMatchStudent] = useState(null);

  const saveListState = useCallback((overrides = {}) => {
    writeAdminStudentsListState({
      searchText,
      finalCountFilter,
      expandedRowKeys,
      pagination,
      scrollY: window.scrollY || 0,
      ...overrides,
    });
  }, [expandedRowKeys, finalCountFilter, pagination, searchText]);

  const experimentMap = useMemo(() => {
    const map = new Map();
    experiments.forEach((experiment) => map.set(experiment.id, experiment));
    return map;
  }, [experiments]);

  const metrics = useMemo(() => {
    const summary = studentListSummary || {};
    return {
      totalStudents: summary.totalStudents ?? studentTotal,
      finalSubmitted: summary.finalSubmittedCount || 0,
      draftSubmitted: summary.draftSubmittedCount || 0,
      pendingSync: summary.pendingSyncCount || 0,
    };
  }, [studentListSummary, studentTotal]);

  const loadData = useCallback(async (options = {}) => {
    const nextPagination = options.pagination || pagination;
    const nextSearchText = options.searchText ?? searchText;
    const nextFinalCountFilter = options.finalCountFilter ?? finalCountFilter;
    setLoading(true);
    try {
      const studentPayload = await getAdminStudents({
        page: nextPagination.current || 1,
        pageSize: ADMIN_STUDENTS_PAGE_SIZE,
        query: nextSearchText.trim() || undefined,
        finalCountFilter: nextFinalCountFilter === 'all' ? undefined : nextFinalCountFilter,
      });
      setStudents(studentPayload.items || []);
      setStudentTotal(studentPayload.total || 0);
      setStudentListSummary(studentPayload.summary || null);
    } catch (error) {
      message.error(error.response?.data?.detail || '无法加载用户管理数据');
    } finally {
      setLoading(false);
    }
  }, [finalCountFilter, pagination, searchText]);

  useEffect(() => {
    let active = true;
    experimentsApi.listExperiments()
      .then((rows) => {
        if (active) setExperiments(rows || []);
      })
      .catch(() => {
        if (active) message.error('无法加载实验配置');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadData();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const loadStudentExperiments = useCallback(async (studentId, { force = false } = {}) => {
    const target = students.find((student) => student.id === studentId);
    if (!target || (!force && Array.isArray(target.experiments) && target.experiments.length > 0)) {
      return target?.experiments || [];
    }
    setStudentExperimentLoadingIds((prev) => Array.from(new Set([...prev, studentId])));
    try {
      const rows = await getAdminStudentExperiments(studentId);
      setStudents((prev) => prev.map((student) => (
        student.id === studentId ? { ...student, experiments: rows || [] } : student
      )));
      return rows || [];
    } catch (error) {
      message.error(error.response?.data?.detail || '加载学生实验列表失败');
      return [];
    } finally {
      setStudentExperimentLoadingIds((prev) => prev.filter((id) => id !== studentId));
    }
  }, [students]);

  useEffect(() => {
    expandedRowKeys.forEach((studentId) => {
      if (students.some((student) => student.id === studentId)) {
        loadStudentExperiments(studentId);
      }
    });
  }, [expandedRowKeys, loadStudentExperiments, students]);

  const revokeScreenshotUrls = useCallback((urls) => {
    Object.values(urls || {}).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, []);

  useEffect(() => () => {
    revokeScreenshotUrls(screenshotUrls);
  }, [revokeScreenshotUrls, screenshotUrls]);

  useEffect(() => {
    saveListState();
  }, [saveListState]);

  useEffect(() => {
    if (didRestoreScrollRef.current || loading || students.length === 0) return;
    didRestoreScrollRef.current = true;
    const scrollY = restoredScrollYRef.current;
    if (!scrollY) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
  }, [loading, students.length]);

  const handleAddStudent = async () => {
    const values = await addForm.validateFields();
    const studentNo = String(values.studentNo || '').trim();
    const password = values.password || studentNo;
    setAddSubmitting(true);
    try {
      const preview = await previewLogin(studentNo).catch(() => null);
      if (preview && !preview.is_student_login) {
        message.error('请输入学生学号。');
        return;
      }
      await createAdminStudent({
        studentNo,
        password,
      });
      message.success('学生已添加');
      setAddOpen(false);
      addForm.resetFields();
      await loadData();
    } catch (error) {
      message.error(error.response?.data?.detail || error.message || '添加学生失败');
    } finally {
      setAddSubmitting(false);
    }
  };

  const openAddStudentModal = () => {
    addForm.setFieldsValue({
      studentNo: DEFAULT_STUDENT_NO_PREFIX,
      password: DEFAULT_STUDENT_NO_PREFIX,
    });
    setAddOpen(true);
  };

  const handleRefreshStudent = async (student) => {
    try {
      const job = await syncAdminStudentOverview(student.id);
      setSyncJob(job);
      setSyncStudent(student);
      if (!workspaceTaskRunner?.runAutomationJob) {
        setSyncModalOpen(true);
        return;
      }
      message.success('学生学校状态刷新已开始，可继续处理其他学生。');
      void workspaceTaskRunner.runAutomationJob({
        job,
        jobKey: `school-overview-${job.jobId}`,
        title: `${student.studentNo} 学校状态刷新`,
        description: '正在后台同步该学生学校系统实验状态',
        steps: OVERVIEW_SYNC_STEPS,
        stepAliases: OVERVIEW_SYNC_STEP_ALIASES,
        successMessage: '学生学校状态刷新完成。',
        failureMessage: '学生学校状态刷新失败。',
        onSuccess: () => {
          loadData();
          loadStudentExperiments(student.id, { force: true });
        },
      }).catch(() => null);
    } catch (error) {
      message.error(error.response?.data?.detail || '刷新学校状态失败');
    }
  };

  const fetchAllStudentsForBulkAction = useCallback(async ({ filter = 'all' } = {}) => {
    const firstPage = await getAdminStudents({
      page: 1,
      pageSize: ADMIN_STUDENTS_BULK_PAGE_SIZE,
      finalCountFilter: filter === 'all' ? undefined : filter,
    });
    const allItems = [...(firstPage.items || [])];
    const total = firstPage.total || allItems.length;
    const totalPages = Math.ceil(total / ADMIN_STUDENTS_BULK_PAGE_SIZE);
    for (let page = 2; page <= totalPages; page += 1) {
      const payload = await getAdminStudents({
        page,
        pageSize: ADMIN_STUDENTS_BULK_PAGE_SIZE,
        finalCountFilter: filter === 'all' ? undefined : filter,
      });
      allItems.push(...(payload.items || []));
    }
    return allItems;
  }, []);

  const runOverviewSyncJobForStudent = useCallback(async (student, options = {}) => {
    const job = await syncAdminStudentOverview(student.id, {
      closeSessionAfterFinish: options.closeSessionAfterFinish === true,
    });
    if (!workspaceTaskRunner?.runAutomationJob) {
      return job;
    }
    return workspaceTaskRunner.runAutomationJob({
      job,
      jobKey: `school-overview-${job.jobId}`,
      title: `${student.studentNo || student.username || student.id} 学校状态刷新`,
      description: '正在后台同步该学生学校系统实验状态',
      steps: OVERVIEW_SYNC_STEPS,
      stepAliases: OVERVIEW_SYNC_STEP_ALIASES,
      successMessage: '学生学校状态刷新完成。',
      failureMessage: '学生学校状态刷新失败。',
      onSuccess: () => {
        if (expandedRowKeys.includes(student.id)) {
          loadStudentExperiments(student.id, { force: true });
        }
      },
    });
  }, [expandedRowKeys, loadStudentExperiments, workspaceTaskRunner]);

  const runFinalSubmitDraftsJobForStudent = useCallback(async (student) => {
    const job = await finalSubmitAdminStudentDrafts(student.id);
    if (!workspaceTaskRunner?.runAutomationJob) {
      return job;
    }
    return workspaceTaskRunner.runAutomationJob({
      job,
      jobKey: `admin-final-submit-drafts-${job.jobId}`,
      title: `${student.studentNo || student.username || student.id} 批量正式提交`,
      description: '正在按顺序将学校系统临时提交实验转为正式提交',
      steps: FINAL_SUBMIT_DRAFTS_STEPS,
      stepAliases: FINAL_SUBMIT_DRAFTS_STEP_ALIASES,
      successMessage: '批量正式提交完成，状态已刷新。',
      failureMessage: '批量正式提交失败。',
      onSuccess: () => {
        if (expandedRowKeys.includes(student.id)) {
          loadStudentExperiments(student.id, { force: true });
        }
      },
    });
  }, [expandedRowKeys, loadStudentExperiments, workspaceTaskRunner]);

  const handleRefreshAllStudents = async (options = {}) => {
    if (bulkRefreshLoading) return;
    const filter = options.filter || 'lt8';
    const closeSessionAfterFinish = options.closeSessionAfterFinish !== false;
    const concurrency = Math.max(1, Math.min(10, Number(options.concurrency) || ADMIN_STUDENTS_REFRESH_DEFAULT_CONCURRENCY));
    const rateLimitCount = Math.max(1, Math.min(20, Number(options.rateLimitCount) || ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_COUNT));
    const rateLimitWindowSeconds = Math.max(1, Math.min(600, Number(options.rateLimitWindowSeconds) || ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_WINDOW_SECONDS));
    setBulkRefreshLoading(true);
    try {
      const targets = await fetchAllStudentsForBulkAction({ filter });
      if (!targets.length) {
        message.info('没有可刷新的学生');
        return;
      }
      message.success(`已开始刷新 ${targets.length} 个学生：并发 ${concurrency}，每 ${rateLimitWindowSeconds} 秒最多启动 ${rateLimitCount} 个。`);
      const results = await runWithConcurrencyAndRateLimit(
        targets,
        { concurrency, rateLimitCount, rateLimitWindowSeconds },
        (student) => runOverviewSyncJobForStudent(student, { closeSessionAfterFinish }),
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) {
        message.warning(`刷新完成，${failed.length} 个学生失败。`);
      } else {
        message.success('所有学生学校状态刷新完成。');
      }
      await loadData();
      expandedRowKeys.forEach((studentId) => {
        loadStudentExperiments(studentId, { force: true });
      });
    } catch (error) {
      message.error(getApiErrorMessage(error, '刷新所有状态失败'));
    } finally {
      setBulkRefreshLoading(false);
    }
  };

  const handleConfirmBulkRefresh = async () => {
    const values = await bulkRefreshForm.validateFields();
    setBulkRefreshOpen(false);
    await handleRefreshAllStudents({
      filter: values.filter || 'lt8',
      closeSessionAfterFinish: values.closeSessionAfterFinish !== false,
      concurrency: values.concurrency,
      rateLimitCount: values.rateLimitCount,
      rateLimitWindowSeconds: values.rateLimitWindowSeconds,
    });
  };

  const handleCheckCompletion = async (student) => {
    setCompletionStudent(student);
    setCompletionResult(null);
    setCompletionLoading(true);
    try {
      const job = await checkAdminStudentCompletion(student.id);
      setCompletionJob(job);
      if (!workspaceTaskRunner?.runAutomationJob) {
        setCompletionProgressOpen(true);
        return;
      }
      message.success('学校系统填空完整性检查已开始，可继续处理其他学生。');
      void workspaceTaskRunner.runAutomationJob({
        job,
        jobKey: `school-completion-${job.jobId}`,
        title: `${student.studentNo} 填空完整性检查`,
        description: '正在后台检查学校系统已提交实验的填空状态',
        steps: COMPLETION_CHECK_STEPS,
        stepAliases: COMPLETION_CHECK_STEP_ALIASES,
        successMessage: '填空完整性检查完成，可点击查看结果。',
        failureMessage: '填空完整性检查失败。',
        viewAction: {
          type: 'schoolCompletionResult',
          label: '查看',
          studentId: student.id,
          jobId: job.jobId,
          title: `${student.studentNo} 填空完整性检查`,
        },
        onSuccess: (finishedJob) => {
          loadCompletionResult(finishedJob, student);
        },
        onFailure: () => {
          setCompletionLoading(false);
        },
      }).catch(() => null);
    } catch (error) {
      message.error(error.response?.data?.detail || '检查填空完整性失败');
      setCompletionStudent(null);
      setCompletionLoading(false);
    }
  };

  const loadCompletionResult = async (job = completionJob, student = completionStudent) => {
    if (!job?.jobId || !student?.id) return;
    setCompletionLoading(true);
    try {
      const result = await getAdminStudentCompletionCheckResult(student.id, job.jobId);
      setCompletionResult(result);
      setCompletionOpen(true);
    } catch (error) {
      message.error(error.response?.data?.detail || '读取检查结果失败');
    } finally {
      setCompletionLoading(false);
    }
  };

  const handleCaptureSubmissionScreenshots = async (student) => {
    setScreenshotStudent(student);
    setScreenshotResult(null);
    setScreenshotLoading(true);
    setScreenshotUrls((prev) => {
      revokeScreenshotUrls(prev);
      return {};
    });
    try {
      const job = await captureAdminStudentSubmissionScreenshots(student.id);
      setScreenshotJob(job);
      if (!workspaceTaskRunner?.runAutomationJob) {
        setScreenshotProgressOpen(true);
        return;
      }
      message.success('所有提交截图任务已开始，可继续处理其他学生。');
      void workspaceTaskRunner.runAutomationJob({
        job,
        jobKey: `school-submission-screenshots-${job.jobId}`,
        title: `${student.studentNo} 提交截图`,
        description: '正在后台截取学校系统已提交实验报告',
        steps: SUBMISSION_SCREENSHOT_STEPS,
        stepAliases: SUBMISSION_SCREENSHOT_STEP_ALIASES,
        successMessage: '所有提交截图已生成，结果已打开。',
        failureMessage: '查看所有提交截图失败。',
        onSuccess: (finishedJob) => {
          loadSubmissionScreenshotsResult(finishedJob, student);
        },
        onFailure: () => {
          setScreenshotLoading(false);
        },
      }).catch(() => null);
    } catch (error) {
      message.error(error.response?.data?.detail || '查看所有提交截图失败');
      setScreenshotStudent(null);
      setScreenshotLoading(false);
    }
  };

  const loadSubmissionScreenshotsResult = async (job = screenshotJob, student = screenshotStudent) => {
    if (!job?.jobId || !student?.id) return;
    setScreenshotLoading(true);
    try {
      const result = await getAdminStudentSubmissionScreenshotsResult(student.id, job.jobId);
      const captured = (result.experiments || []).filter((item) => item.captureStatus === 'captured' && item.screenshotAvailable);
      const entries = await Promise.all(captured.map(async (item) => {
        try {
          const blob = await getAdminStudentSubmissionScreenshotBlob(student.id, job.jobId, item.experimentId);
          return [item.experimentId, URL.createObjectURL(blob)];
        } catch (error) {
          return [item.experimentId, ''];
        }
      }));
      setScreenshotUrls((prev) => {
        revokeScreenshotUrls(prev);
        return Object.fromEntries(entries.filter(([, url]) => url));
      });
      setScreenshotResult(result);
      setScreenshotOpen(true);
    } catch (error) {
      message.error(error.response?.data?.detail || '读取提交截图结果失败');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const handleOneClickSubmit = (student, experimentRow) => {
    const experiment = experimentMap.get(experimentRow.id) || {
      id: experimentRow.id,
      name: experimentRow.name,
      inputs: { images: [] },
    };
    const nextModalKey = `${student.id || student.studentNo || 'student'}:${experiment.id}:single`;
    setSubmitStudent(student);
    setSubmitTargets([experiment]);
    setSubmitModalKey(nextModalKey);
    submitModalKeyRef.current = nextModalKey;
    setSubmitModalOpen(true);
  };

  const handleBatchSubmit = async (student) => {
    const experimentsForStudent = await loadStudentExperiments(student.id);
    const targetRows = (experimentsForStudent || [])
      .filter((experiment) => !['school_final_submitted', 'school_graded'].includes(experiment.schoolStatus));
    const targets = targetRows
      .map((experimentRow) => experimentMap.get(experimentRow.id) || {
        id: experimentRow.id,
        name: experimentRow.name,
        inputs: { images: [] },
      });

    if (targets.length === 0) {
      message.info('该学生没有需要批量提交的实验');
      return;
    }
    const nextModalKey = `${student.id || student.studentNo || 'student'}:${targets.map((target) => target.id).join(',') || 'batch'}:batch`;
    setSubmitStudent(student);
    setSubmitTargets(targets);
    setSubmitModalKey(nextModalKey);
    submitModalKeyRef.current = nextModalKey;
    setSubmitModalOpen(true);
  };

  const handleFinalSubmitDrafts = async (student) => {
    const finalCount = student.summary?.finalSubmittedCount || 0;
    const draftCount = student.summary?.draftSubmittedCount || 0;
    if (finalCount + draftCount !== 8) {
      message.warning('该学生学校系统正式提交和临时提交数量之和必须刚好为 8，才能执行正式提交。');
      return;
    }
    if (draftCount <= 0) {
      message.info('该学生没有需要转为正式提交的临时提交实验。');
      return;
    }
    try {
      const job = await finalSubmitAdminStudentDrafts(student.id);
      message.success('批量正式提交已开始，可继续处理其他学生。');
      void workspaceTaskRunner.runAutomationJob({
        job,
        jobKey: `admin-final-submit-drafts-${job.jobId}`,
        title: `${student.studentNo} 批量正式提交`,
        description: '正在按顺序将学校系统临时提交实验转为正式提交',
        steps: FINAL_SUBMIT_DRAFTS_STEPS,
        stepAliases: FINAL_SUBMIT_DRAFTS_STEP_ALIASES,
        successMessage: '批量正式提交完成，状态已刷新。',
        failureMessage: '批量正式提交失败。',
        onSuccess: () => {
          loadData();
          loadStudentExperiments(student.id, { force: true });
        },
      }).catch(() => null);
    } catch (error) {
      message.error(getApiErrorMessage(error, '批量正式提交失败'));
    }
  };

  const handleFinalSubmitAllDrafts = async () => {
    if (bulkFinalSubmitLoading) return;
    setBulkFinalSubmitLoading(true);
    try {
      const allStudents = await fetchAllStudentsForBulkAction();
      const targets = allStudents.filter((student) => {
        const finalCount = student.summary?.finalSubmittedCount || 0;
        const draftCount = student.summary?.draftSubmittedCount || 0;
        return finalCount + draftCount === 8 && draftCount > 0;
      });
      if (!targets.length) {
        message.info('没有满足“正式提交+临时提交数量刚好为 8 且存在临时提交”的学生。');
        return;
      }
      const confirmed = await confirmModal({
        title: '正式提交所有',
        content: `将为 ${targets.length} 个学生把学校系统临时提交转为正式提交，并发数 ${ADMIN_STUDENTS_BULK_CONCURRENCY}。确认继续？`,
        okText: '正式提交所有',
        cancelText: '取消',
        okButtonProps: { danger: false, style: { backgroundColor: '#16a34a', borderColor: '#16a34a' } },
      });
      if (!confirmed) return;
      message.success(`已开始正式提交 ${targets.length} 个学生，并发数 ${ADMIN_STUDENTS_BULK_CONCURRENCY}。`);
      const results = await runWithConcurrency(
        targets,
        ADMIN_STUDENTS_BULK_CONCURRENCY,
        runFinalSubmitDraftsJobForStudent,
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length) {
        message.warning(`正式提交批量任务完成，${failed.length} 个学生失败。`);
      } else {
        message.success('所有符合条件的学生正式提交完成。');
      }
      await loadData();
      expandedRowKeys.forEach((studentId) => {
        loadStudentExperiments(studentId, { force: true });
      });
    } catch (error) {
      message.error(getApiErrorMessage(error, '正式提交所有失败'));
    } finally {
      setBulkFinalSubmitLoading(false);
    }
  };

  const handleEditExperiment = async (student, experiment) => {
    saveListState({ scrollY: window.scrollY || 0 });
    if (experiment.submissionId) {
      navigate(`/workspace/reviewer/tasks/${experiment.submissionId}?exp=${experiment.id}&from=admin-students`);
      return;
    }
    try {
      const submission = await ensureAdminStudentEditSubmission(student.id, experiment.id);
      await loadData();
      await loadStudentExperiments(student.id, { force: true });
      navigate(`/workspace/reviewer/tasks/${submission.id}?exp=${experiment.id}&from=admin-students`);
    } catch (error) {
      message.error(error.response?.data?.detail || error.message || '创建编辑任务失败');
    }
  };

  const handleReviewExperiment = (experiment) => {
    if (experiment.status !== 'reviewing' || !experiment.submissionId) return;
    saveListState({ scrollY: window.scrollY || 0 });
    navigate(`/workspace/reviewer/tasks/${experiment.submissionId}?exp=${experiment.id}&from=admin-students`);
  };

  const handleMatchExperimentImages = (student, experiment) => {
    if (!experiment.submissionId || !experiment.submissionBatchId) return;
    saveListState({ scrollY: window.scrollY || 0 });
    const batchId = experiment.submissionBatchId;
    setImageMatchStudent(student);
    setImageMatchBatch({
      row_key: `${student.studentNo || student.id}-${batchId}`,
      batch_id: batchId,
      student_id: student.studentNo || String(student.id),
      name: student.realName || '姓名未同步',
      experiments: [
        {
          id: experiment.id,
          submission_id: experiment.submissionId,
          name: experiment.name,
          status: experiment.status,
          batch_id: batchId,
          image_count: experiment.imageCount || 0,
          assigned_image_count: experiment.assignedImageCount || 0,
          preprocess_status: experiment.preprocessStatus,
          preprocess_error: experiment.preprocessError,
          student_id: student.studentNo || String(student.id),
        },
      ],
    });
  };

  const handleSubmitModal = async (batchImages, targetStudent, isHungup = false, planName = 'pay_per_use', resolvedTargets = null, submitOptions = {}) => {
    const isBackgroundAutoMatch = submitOptions.backgroundAutoMatch === true;
    if (!isBackgroundAutoMatch && submitOptions.modalInstanceKey && submitOptions.modalInstanceKey !== submitModalKeyRef.current) {
      return { submittedCount: 0, ignored: true };
    }
    const studentNo = submitStudent?.studentNo || targetStudent;
    try {
      const { submittedCount } = await submitOneClickExperimentBatch({
        targets: resolvedTargets || submitTargets,
        batchImages,
        targetStudent: studentNo,
        isHungup,
        planName,
        ...submitOptions,
      });
      if (submittedCount === 0) {
        message.warning('请至少上传一个实验的图片');
        return;
      }
      message.success('提交成功，后台正在处理中');
      if (!isBackgroundAutoMatch || submitOptions.modalInstanceKey === submitModalKeyRef.current) {
        setSubmitModalOpen(false);
      }
      await loadData();
      if (submitStudent?.id) {
        await loadStudentExperiments(submitStudent.id, { force: true });
      }
    } catch (error) {
      if (error.response?.status !== 403 && error.status !== 403) {
        message.error(getApiErrorMessage(error, '提交失败'));
      }
      throw error;
    }
  };

  const expandedRowRender = (student) => {
    const columns = [
      {
        title: '实验名称',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: '学校提交状态',
        dataIndex: 'schoolStatus',
        key: 'schoolStatus',
        align: 'center',
        render: (status, record) => {
          const meta = getSchoolStatusMeta(status, record);
          return <StatusBadge tone={meta.tone} indicator={meta.indicator}>{meta.label}</StatusBadge>;
        },
      },
      {
        title: '平台处理状态',
        dataIndex: 'status',
        key: 'status',
        align: 'center',
        render: (status) => {
          const meta = experimentStatusMeta(status);
          return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
        },
      },
      {
        title: '最后同步',
        dataIndex: 'schoolStatusSyncedAt',
        key: 'schoolStatusSyncedAt',
        render: formatDateTime,
      },
      {
        title: '审核',
        key: 'review',
        align: 'center',
        render: (_, experiment) => {
          const canReview = experiment.status === 'reviewing' && Boolean(experiment.submissionId);
          const canMatch = Boolean(experiment.submissionId && experiment.submissionBatchId);
          return (
            <Space size={6}>
              <OutlineButton
                disabled={!canReview}
                onClick={() => handleReviewExperiment(experiment)}
              >
                审核
              </OutlineButton>
              <OutlineButton
                disabled={!canMatch}
                onClick={() => handleMatchExperimentImages(student, experiment)}
              >
                匹配
              </OutlineButton>
            </Space>
          );
        },
      },
      {
        title: '操作',
        key: 'actions',
        align: 'right',
        render: (_, experiment) => (
          <Space>
            <OutlineButton
              onClick={() => handleEditExperiment(student, experiment)}
            >
              编辑与提交
            </OutlineButton>
            <GoldButton icon={<CrownOutlined />} onClick={() => handleOneClickSubmit(student, experiment)}>
              一键提交
            </GoldButton>
          </Space>
        ),
      },
    ];

    return (
      <Table
        columns={columns}
        dataSource={student.experiments || []}
        pagination={false}
        rowKey="id"
        size="small"
        loading={studentExperimentLoadingIds.includes(student.id)}
      />
    );
  };

  const columns = [
    {
      title: '学号',
      dataIndex: 'studentNo',
      key: 'studentNo',
      width: 150,
    },
    {
      title: '姓名',
      dataIndex: 'realName',
      key: 'realName',
      width: 140,
      render: (value) => value || '姓名未同步',
    },
    {
      title: '已完成实验',
      key: 'finalSubmitted',
      align: 'center',
      render: (_, student) => `${student.summary?.finalSubmittedCount || 0}/${student.summary?.totalExperimentCount || 0}`,
    },
    {
      title: '已临时提交',
      key: 'draftSubmitted',
      align: 'center',
      render: (_, student) => student.summary?.draftSubmittedCount || 0,
    },
    {
      title: '最近刷新',
      dataIndex: 'lastSyncedAt',
      key: 'lastSyncedAt',
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, student) => (
        <Space>
          <Tooltip title="当正式提交和临时提交数量之和为 8 时，将临时提交实验转为正式提交">
            <Button
              type="primary"
              onClick={() => handleFinalSubmitDrafts(student)}
              style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }}
            >
              正式提交
            </Button>
          </Tooltip>
          <Tooltip title="检查该学生所有实验是否漏填">
            <OutlineButton onClick={() => handleCheckCompletion(student)}>
              填写完整性
            </OutlineButton>
          </Tooltip>
          <Tooltip title="查看该学生所有已临时提交或正式提交实验的学校系统截图">
            <OutlineButton onClick={() => handleCaptureSubmissionScreenshots(student)}>
              所有截图
            </OutlineButton>
          </Tooltip>
          <Tooltip title="同步该学生学校系统实验状态">
            <OutlineButton onClick={() => handleRefreshStudent(student)}>
              刷新状态
            </OutlineButton>
          </Tooltip>
          <Tooltip title="为该学生批量提交未正式提交的实验">
            <GoldButton icon={<CrownOutlined />} onClick={() => handleBatchSubmit(student)}>
              批量提交
            </GoldButton>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const completionColumns = [
    {
      title: '实验名称',
      dataIndex: 'experimentName',
      key: 'experimentName',
    },
    {
      title: '完整性',
      dataIndex: 'complete',
      key: 'complete',
      align: 'center',
      width: 120,
      render: (complete, record) => {
        if (record.checkStatus === 'skipped') {
          return <StatusBadge tone="default">跳过</StatusBadge>;
        }
        if (record.checkStatus === 'error') {
          return <StatusBadge tone="failed">打开失败</StatusBadge>;
        }
        return complete
          ? <CheckCircleOutlined style={{ color: '#16a34a', fontSize: 18 }} />
          : <CloseCircleOutlined style={{ color: '#dc2626', fontSize: 18 }} />;
      },
    },
    {
      title: '学校状态',
      dataIndex: 'schoolStatus',
      key: 'schoolStatus',
      width: 140,
      align: 'center',
      render: (status, record) => {
        const meta = getSchoolStatusMeta(status, record);
        return <StatusBadge tone={meta.tone} indicator={meta.indicator}>{meta.label}</StatusBadge>;
      },
    },
  ];

  const completionExpandedRowRender = (record) => {
    if (record.complete && !['skipped', 'error'].includes(record.checkStatus)) return null;
    if (['skipped', 'error'].includes(record.checkStatus)) {
      return (
        <div style={{ padding: '8px 12px', color: '#6b7280' }}>
          {record.reason || (record.checkStatus === 'skipped' ? '学校状态未临时提交或正式提交，跳过检查' : '学校实验报告未能打开')}
        </div>
      );
    }
    const missing = record.missing || [];
    return (
      <div style={{ padding: '8px 12px' }}>
        {missing.length ? (
          <Space wrap>
            {missing.map((item) => (
              <StatusBadge key={item.key} tone="failed">{item.label || item.key}</StatusBadge>
            ))}
          </Space>
        ) : (
          <span style={{ color: '#6b7280' }}>无缺失项</span>
        )}
      </div>
    );
  };

  const screenshotColumns = [
    {
      title: '实验名称',
      dataIndex: 'experimentName',
      key: 'experimentName',
    },
    {
      title: '截图状态',
      dataIndex: 'captureStatus',
      key: 'captureStatus',
      align: 'center',
      width: 120,
      render: (captureStatus) => {
        if (captureStatus === 'captured') {
          return <StatusBadge tone="success">已截图</StatusBadge>;
        }
        if (captureStatus === 'skipped') {
          return <StatusBadge tone="default">跳过</StatusBadge>;
        }
        if (captureStatus === 'error') {
          return <StatusBadge tone="failed">打开失败</StatusBadge>;
        }
        return <StatusBadge tone="default">{captureStatus || '未知'}</StatusBadge>;
      },
    },
    {
      title: '学校状态',
      dataIndex: 'schoolStatus',
      key: 'schoolStatus',
      width: 140,
      align: 'center',
      render: (status, record) => {
        const meta = getSchoolStatusMeta(status, record);
        return <StatusBadge tone={meta.tone} indicator={meta.indicator}>{meta.label}</StatusBadge>;
      },
    },
  ];

  const screenshotExpandedRowRender = (record) => {
    if (record.captureStatus !== 'captured') {
      return (
        <div style={{ padding: '8px 12px', color: '#6b7280' }}>
          {record.reason || '该实验未生成截图'}
        </div>
      );
    }
    const imageUrl = screenshotUrls[record.experimentId];
    return (
      <div style={{ padding: '10px 12px', background: '#f5f7fb', borderRadius: 8 }}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${record.experimentName} 学校系统提交截图`}
            style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
        ) : (
          <span style={{ color: '#6b7280' }}>截图文件加载失败</span>
        )}
      </div>
    );
  };

  return (
    <section className="workspace-standard-page">
      <PageHeading
        title="用户管理"
        description="按学生查看学校提交状态与平台处理状态，并为指定学生发起实验提交。"
        actions={
          <Space wrap>
            <Button
              type="primary"
              loading={bulkFinalSubmitLoading}
              onClick={handleFinalSubmitAllDrafts}
              style={{ backgroundColor: '#16a34a', borderColor: '#16a34a' }}
            >
              正式提交所有
            </Button>
            <OutlineButton
              icon={<ReloadOutlined />}
              loading={bulkRefreshLoading}
              onClick={() => {
                bulkRefreshForm.setFieldsValue({
                  filter: 'lt8',
                  closeSessionAfterFinish: true,
                  concurrency: ADMIN_STUDENTS_REFRESH_DEFAULT_CONCURRENCY,
                  rateLimitCount: ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_COUNT,
                  rateLimitWindowSeconds: ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
                });
                setBulkRefreshOpen(true);
              }}
            >
              刷新所有状态
            </OutlineButton>
            <GoldButton icon={<PlusOutlined />} onClick={openAddStudentModal}>
              添加学生
            </GoldButton>
          </Space>
        }
      />

      <div className="ui-stat-grid">
        <StatCard icon={<TeamOutlined />} label="全部学生" value={metrics.totalStudents} tone="blue" />
        <StatCard icon={<CheckCircleOutlined />} label="已完成实验" value={metrics.finalSubmitted} tone="green" />
        <StatCard icon={<CloudUploadOutlined />} label="已临时提交" value={metrics.draftSubmitted} tone="amber" />
        <StatCard icon={<AppstoreOutlined />} label="待同步状态" value={metrics.pendingSync} tone="violet" />
      </div>

      <TablePanel
        title="学生列表"
        actions={
          <Space>
            <Select
              value={finalCountFilter}
              onChange={(value) => {
                const nextPagination = { ...pagination, current: 1 };
                setFinalCountFilter(value);
                setPagination(nextPagination);
                saveListState({ finalCountFilter: value, pagination: nextPagination });
                loadData({ finalCountFilter: value, pagination: nextPagination });
              }}
              style={{ width: 170 }}
              options={[
                { value: 'all', label: '全部完成数' },
                { value: 'lt8', label: '完成实验数 < 8' },
                { value: 'gte8', label: '完成实验数 ≥ 8' },
              ]}
            />
            <Input
              placeholder="搜索学号 / 姓名"
              value={searchText}
              onChange={(event) => {
                const nextSearchText = event.target.value;
                const nextPagination = { ...pagination, current: 1 };
                setSearchText(nextSearchText);
                setPagination(nextPagination);
                saveListState({ searchText: nextSearchText, pagination: nextPagination });
              }}
              style={{ width: 240 }}
            />
            <OutlineButton icon={<ReloadOutlined />} onClick={loadData}>
              刷新列表
            </OutlineButton>
          </Space>
        }
      >
        <Table
          loading={loading}
          columns={columns}
          dataSource={students}
          expandable={{
            expandedRowRender,
            expandedRowKeys,
            onExpandedRowsChange: (nextKeys) => {
              const keys = Array.from(nextKeys);
              setExpandedRowKeys(keys);
              keys.forEach((studentId) => {
                loadStudentExperiments(studentId);
              });
              saveListState({ expandedRowKeys: keys, scrollY: window.scrollY || 0 });
            },
          }}
          rowKey="id"
          pagination={{
            ...pagination,
            total: studentTotal,
            showSizeChanger: false,
          }}
          onChange={(nextPagination) => {
            const nextState = {
              current: nextPagination.current || 1,
              pageSize: ADMIN_STUDENTS_PAGE_SIZE,
            };
            setPagination(nextState);
            saveListState({ pagination: nextState, scrollY: window.scrollY || 0 });
          }}
          scroll={{ x: 900 }}
        />
      </TablePanel>

      <Modal
        title="添加学生"
        open={addOpen}
        confirmLoading={addSubmitting}
        onOk={handleAddStudent}
        onCancel={() => {
          setAddOpen(false);
          addForm.resetFields();
        }}
        okText="添加"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={addForm}
          layout="vertical"
          autoComplete="off"
          onValuesChange={(changedValues) => {
            if (!Object.prototype.hasOwnProperty.call(changedValues, 'studentNo')) return;
            addForm.setFieldsValue({
              password: changedValues.studentNo,
            });
          }}
        >
          <Form.Item
            label="学号"
            name="studentNo"
            rules={[{ required: true, message: '请输入学号' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="学校系统密码"
            name="password"
            rules={[{ required: true, message: '请输入学校系统密码' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="刷新所有状态"
        open={bulkRefreshOpen}
        confirmLoading={bulkRefreshLoading}
        onOk={handleConfirmBulkRefresh}
        onCancel={() => setBulkRefreshOpen(false)}
        okText="开始刷新"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={bulkRefreshForm}
          layout="vertical"
          initialValues={{
            filter: 'lt8',
            closeSessionAfterFinish: true,
            concurrency: ADMIN_STUDENTS_REFRESH_DEFAULT_CONCURRENCY,
            rateLimitCount: ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_COUNT,
            rateLimitWindowSeconds: ADMIN_STUDENTS_REFRESH_DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
          }}
        >
          <Form.Item
            label="筛选条件"
            name="filter"
            rules={[{ required: true, message: '请选择筛选条件' }]}
          >
            <Select
              options={[
                { value: 'lt8', label: '只刷新完成实验数 < 8 的学生' },
                { value: 'gte8', label: '只刷新完成实验数 ≥ 8 的学生' },
                { value: 'all', label: '刷新全部学生' },
              ]}
            />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Form.Item
              label="并发数"
              name="concurrency"
              rules={[{ required: true, message: '请输入并发数' }]}
            >
              <InputNumber min={1} max={10} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="窗口内最多启动"
              name="rateLimitCount"
              rules={[{ required: true, message: '请输入窗口内最多启动数' }]}
            >
              <InputNumber min={1} max={20} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="时间窗口(秒)"
              name="rateLimitWindowSeconds"
              rules={[{ required: true, message: '请输入时间窗口' }]}
            >
              <InputNumber min={1} max={600} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="closeSessionAfterFinish" valuePropName="checked">
            <Checkbox>每个学生刷新完成后立刻关闭学校浏览器对话</Checkbox>
          </Form.Item>
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            非 Headless 模式建议使用较低并发和较严格的启动速率，并保持关闭对话开启，避免同时保留大量可视浏览器窗口。
          </div>
        </Form>
      </Modal>

      <Modal
        title="学校系统填空完整性检查"
        open={completionOpen}
        footer={null}
        onCancel={() => setCompletionOpen(false)}
        width={760}
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#4b5563' }}>
          {completionResult ? (
            <>
              <strong>{completionResult.studentNo}</strong>
              {completionResult.realName ? ` ${completionResult.realName}` : ''}
              {' · '}
              完整 {completionResult.summary?.completeExperimentCount || 0}/
              {completionResult.summary?.checkedExperimentCount || 0}
              {' · '}
              缺失 {completionResult.summary?.missingCount || 0} 项
              {' · '}
              跳过 {completionResult.summary?.skippedExperimentCount || 0} 个
              {' · '}
              打开失败 {completionResult.summary?.errorExperimentCount || 0} 个
            </>
          ) : '正在检查...'}
        </div>
        <Table
          loading={completionLoading}
          columns={completionColumns}
          dataSource={completionResult?.experiments || []}
          rowKey="experimentId"
          pagination={false}
          size="small"
          expandable={{
            expandedRowRender: completionExpandedRowRender,
            rowExpandable: (record) => !record.complete || ['skipped', 'error'].includes(record.checkStatus),
          }}
        />
      </Modal>

      <Modal
        title="学校系统所有提交截图"
        open={screenshotOpen}
        footer={null}
        onCancel={() => setScreenshotOpen(false)}
        width="min(1120px, 94vw)"
        destroyOnClose
      >
        <div style={{ marginBottom: 12, color: '#4b5563' }}>
          {screenshotResult ? (
            <>
              <strong>{screenshotResult.studentNo}</strong>
              {screenshotResult.realName ? ` ${screenshotResult.realName}` : ''}
              {' · '}
              已截图 {screenshotResult.summary?.capturedExperimentCount || 0} 个
              {' · '}
              跳过 {screenshotResult.summary?.skippedExperimentCount || 0} 个
              {' · '}
              打开失败 {screenshotResult.summary?.errorExperimentCount || 0} 个
            </>
          ) : '正在生成截图...'}
        </div>
        <Table
          loading={screenshotLoading}
          columns={screenshotColumns}
          dataSource={screenshotResult?.experiments || []}
          rowKey="experimentId"
          pagination={false}
          size="small"
          scroll={{ y: '68vh' }}
          expandable={{
            expandedRowRender: screenshotExpandedRowRender,
            rowExpandable: () => true,
          }}
        />
      </Modal>

      <ProSubmitModal
        open={submitModalOpen}
        experiments={submitTargets}
        onCancel={() => setSubmitModalOpen(false)}
        onSubmit={handleSubmitModal}
        fixedTargetStudent={submitStudent?.studentNo || ''}
        instanceKey={submitModalKey}
      />

      <ReviewBatchImageAssignmentModal
        open={Boolean(imageMatchBatch)}
        batch={imageMatchBatch}
        onClose={() => {
          setImageMatchBatch(null);
          setImageMatchStudent(null);
        }}
        onFinished={() => {
          loadData();
          if (imageMatchStudent?.id) {
            loadStudentExperiments(imageMatchStudent.id, { force: true });
          }
        }}
        onPrepareStarted={() => {
          if (imageMatchStudent?.id) {
            loadStudentExperiments(imageMatchStudent.id, { force: true });
          }
        }}
      />

      <AutomationProgressModal
        open={syncModalOpen}
        initialJob={syncJob}
        title={`${syncStudent?.studentNo || ''} 学校状态刷新`.trim()}
        steps={OVERVIEW_SYNC_STEPS}
        stepAliases={OVERVIEW_SYNC_STEP_ALIASES}
        defaultMessageCode="school.overview.syncing"
        failureMessageCode="school.overview.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            loadData();
          }
        }}
        onClose={() => {
          setSyncModalOpen(false);
          setSyncJob(null);
          setSyncStudent(null);
          loadData();
        }}
      />

      <AutomationProgressModal
        open={completionProgressOpen}
        initialJob={completionJob}
        title={`${completionStudent?.studentNo || ''} 填空完整性检查`.trim()}
        steps={[
          'school.completion.connecting',
          'school.overview.readingList',
          'school.completion.opening',
          'school.completion.checkingExperiment',
          'school.completion.savingResult',
        ]}
        stepAliases={{
          'school.completion.syncing': 'school.completion.connecting',
          'school.overview.syncing': 'school.completion.connecting',
          'school.overview.connecting': 'school.completion.connecting',
          'school.overview.openingLogin': 'school.completion.connecting',
          'school.overview.loggingIn': 'school.completion.connecting',
          'school.overview.checkingLogin': 'school.completion.connecting',
          'school.overview.recognizingCaptcha': 'school.completion.connecting',
          'school.overview.retryingCaptcha': 'school.completion.connecting',
        }}
        defaultMessageCode="school.completion.syncing"
        failureMessageCode="school.completion.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            loadCompletionResult(job, completionStudent);
          }
        }}
        onClose={(job) => {
          setCompletionProgressOpen(false);
          if (job?.status === 'succeeded') {
            loadCompletionResult(job, completionStudent);
          }
          setCompletionJob(null);
        }}
      />
      <AutomationProgressModal
        open={screenshotProgressOpen}
        initialJob={screenshotJob}
        title={`${screenshotStudent?.studentNo || ''} 提交截图`.trim()}
        steps={SUBMISSION_SCREENSHOT_STEPS}
        stepAliases={SUBMISSION_SCREENSHOT_STEP_ALIASES}
        defaultMessageCode="school.submissionScreenshots.syncing"
        failureMessageCode="school.submissionScreenshots.failed"
        onJobUpdate={(job) => {
          if (job.status === 'succeeded') {
            loadSubmissionScreenshotsResult(job, screenshotStudent);
          }
        }}
        onClose={(job) => {
          setScreenshotProgressOpen(false);
          if (job?.status === 'succeeded') {
            loadSubmissionScreenshotsResult(job, screenshotStudent);
          }
          setScreenshotJob(null);
        }}
      />
    </section>
  );
}
