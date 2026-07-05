import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Result, Spin, Steps } from 'antd';
import { CheckCircleOutlined, CheckOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { renderAutomationMessage } from '../../constants/automationMessages.js';
import { getAutomationJob } from '../../services/automationJobsApi.js';

const SUBMIT_STEPS = [
  'school.submit.saving',
  'school.submit.connecting',
  'school.submit.opening',
  'school.submit.filling',
  'school.submit.verifying',
  'school.submit.submitAction',
  'school.submit.confirming',
  'school.submit.readingStatus',
  'school.submit.updatingPlatform',
];

function normalizeStepCode(messageCode, stepAliases = {}) {
  if (['school.submit.submittingDraft', 'school.submit.submittingFinal'].includes(messageCode)) {
    return 'school.submit.submitAction';
  }
  if (messageCode === 'school.submit.returningList') {
    return 'school.submit.readingStatus';
  }
  return stepAliases[messageCode] || messageCode;
}

function stepIndexFor(messageCode, steps, stepAliases = {}) {
  const index = steps.indexOf(normalizeStepCode(messageCode, stepAliases));
  return index >= 0 ? index : 0;
}

function defaultSuccessMessageCode(job) {
  if (job?.action === 'draft_submit') return 'school.submit.draftSuccess';
  if (job?.action === 'final_submit') return 'school.submit.finalSuccess';
  if (job?.action === 'school_overview_sync') return 'school.overview.success';
  if (job?.action === 'school_detail_sync') return 'school.detail.success';
  return 'school.submit.success';
}

function defaultStepMessageCode(step, job) {
  if (step === 'school.submit.submitAction') {
    return job?.action === 'final_submit' ? 'school.submit.submittingFinal' : 'school.submit.submittingDraft';
  }
  return step;
}

export function AutomationProgressModal({
  open,
  initialJob,
  title = '学校系统任务进度',
  steps = SUBMIT_STEPS,
  defaultMessageCode = 'school.submit.saving',
  failureMessageCode = 'school.submit.failed',
  getSuccessMessageCode = defaultSuccessMessageCode,
  getStepMessageCode = defaultStepMessageCode,
  stepAliases = {},
  onClose,
  onJobUpdate,
}) {
  const [job, setJob] = useState(initialJob || null);
  const [pollError, setPollError] = useState('');

  useEffect(() => {
    if (open) {
      setJob(initialJob || null);
      setPollError('');
    }
  }, [open, initialJob]);

  useEffect(() => {
    if (!open || !job?.jobId || ['succeeded', 'failed'].includes(job.status)) return undefined;

    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await getAutomationJob(job.jobId);
        if (cancelled) return;
        setJob(fresh);
        onJobUpdate?.(fresh);
        setPollError('');
      } catch (err) {
        if (cancelled) return;
        setPollError(err.response?.data?.detail || err.message || '状态读取失败');
      }
    };

    const timer = window.setInterval(tick, 800);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, job?.jobId, job?.status, onJobUpdate]);

  const activeIndex = useMemo(
    () => stepIndexFor(job?.messageCode, steps, stepAliases),
    [job?.messageCode, steps, stepAliases],
  );
  const isDone = job?.status === 'succeeded';
  const isFailed = job?.status === 'failed';
  const currentMessage = renderAutomationMessage(job?.messageCode, job?.messageParams);
  const successMessageCode = getSuccessMessageCode(job);

  return (
    <Modal
      className="automation-progress-modal"
      open={open}
      title={title}
      footer={null}
      closable={isDone || isFailed}
      maskClosable={false}
      keyboard={false}
      onCancel={() => {
        if (isDone || isFailed) onClose?.(job);
      }}
      destroyOnClose
      width={640}
    >
      {isDone ? (
        <Result
          icon={<CheckCircleOutlined />}
          status="success"
          title={renderAutomationMessage(successMessageCode)}
          extra={<Button type="primary" onClick={() => onClose?.(job)}>完成</Button>}
        />
      ) : isFailed ? (
        <Result
          icon={<CloseCircleOutlined />}
          status="error"
          title={currentMessage || renderAutomationMessage(failureMessageCode, { reason: '未知错误' })}
          extra={<Button onClick={() => onClose?.(job)}>关闭</Button>}
        />
      ) : (
        <div className="automation-progress-body">
          <div className="automation-progress-current">
            <Spin indicator={<LoadingOutlined spin />} />
            <span>{currentMessage || renderAutomationMessage(defaultMessageCode)}</span>
          </div>
          {pollError ? (
            <Alert type="warning" showIcon message={pollError} />
          ) : null}
          <Steps
            direction="vertical"
            current={activeIndex}
            items={steps.map((step, index) => ({
              icon: (
                <span className="automation-step-dot">
                  {index < activeIndex ? <CheckOutlined /> : index + 1}
                </span>
              ),
              title: renderAutomationMessage(getStepMessageCode(step, job)),
            }))}
          />
        </div>
      )}
    </Modal>
  );
}
