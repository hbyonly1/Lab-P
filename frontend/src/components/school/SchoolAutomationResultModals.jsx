import React from 'react';
import { Modal, Space, Spin, Table } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { StatusBadge } from '../ui/index.js';
import { getSchoolStatusMeta } from '../../utils/schoolStatusUtils.js';

export const COMPLETION_CHECK_STEPS = [
  'school.completion.connecting',
  'school.overview.readingList',
  'school.completion.opening',
  'school.completion.checkingExperiment',
  'school.completion.savingResult',
];

export const COMPLETION_CHECK_STEP_ALIASES = {
  'school.completion.syncing': 'school.completion.connecting',
  'school.overview.syncing': 'school.completion.connecting',
  'school.overview.connecting': 'school.completion.connecting',
  'school.overview.openingLogin': 'school.completion.connecting',
  'school.overview.loggingIn': 'school.completion.connecting',
  'school.overview.checkingLogin': 'school.completion.connecting',
  'school.overview.recognizingCaptcha': 'school.completion.connecting',
  'school.overview.retryingCaptcha': 'school.completion.connecting',
};

export const SUBMISSION_SCREENSHOT_STEPS = [
  'school.submissionScreenshots.connecting',
  'school.overview.readingList',
  'school.submissionScreenshots.opening',
  'school.submissionScreenshots.capturingExperiment',
  'school.submissionScreenshots.savingResult',
];

export const SUBMISSION_SCREENSHOT_STEP_ALIASES = {
  'school.submissionScreenshots.syncing': 'school.submissionScreenshots.connecting',
  'school.overview.syncing': 'school.submissionScreenshots.connecting',
  'school.overview.connecting': 'school.submissionScreenshots.connecting',
  'school.overview.openingLogin': 'school.submissionScreenshots.connecting',
  'school.overview.loggingIn': 'school.submissionScreenshots.connecting',
  'school.overview.checkingLogin': 'school.submissionScreenshots.connecting',
  'school.overview.recognizingCaptcha': 'school.submissionScreenshots.connecting',
  'school.overview.retryingCaptcha': 'school.submissionScreenshots.connecting',
};

function schoolStatusBadge(status, record) {
  const meta = getSchoolStatusMeta(status, record);
  return <StatusBadge tone={meta.tone} indicator={meta.indicator}>{meta.label}</StatusBadge>;
}

export function SchoolCompletionResultModal({
  open,
  onClose,
  result,
  loading = false,
  title = '学校系统填空完整性检查',
}) {
  const columns = [
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
        if (record.checkStatus === 'skipped') return <StatusBadge tone="default">跳过</StatusBadge>;
        if (record.checkStatus === 'error') return <StatusBadge tone="failed">打开失败</StatusBadge>;
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
      render: schoolStatusBadge,
    },
  ];

  const expandedRowRender = (record) => {
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

  return (
    <Modal
      title={title}
      open={open}
      footer={null}
      onCancel={onClose}
      width={760}
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: '#4b5563' }}>
        {result ? (
          <>
            <strong>{result.studentNo}</strong>
            {result.realName ? ` ${result.realName}` : ''}
            {' · '}
            完整 {result.summary?.completeExperimentCount || 0}/
            {result.summary?.checkedExperimentCount || 0}
            {' · '}
            缺失 {result.summary?.missingCount || 0} 项
            {' · '}
            跳过 {result.summary?.skippedExperimentCount || 0} 个
            {' · '}
            打开失败 {result.summary?.errorExperimentCount || 0} 个
          </>
        ) : '正在检查...'}
      </div>
      <Table
        loading={loading}
        columns={columns}
        dataSource={result?.experiments || []}
        rowKey="experimentId"
        pagination={false}
        size="small"
        expandable={{
          expandedRowRender,
          rowExpandable: (record) => !record.complete || ['skipped', 'error'].includes(record.checkStatus),
        }}
      />
    </Modal>
  );
}

export function SchoolSubmissionScreenshotsModal({
  open,
  onClose,
  result,
  screenshotUrls = {},
  loading = false,
  title = '学校系统所有提交截图',
}) {
  const columns = [
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
        if (captureStatus === 'captured') return <StatusBadge tone="success">已截图</StatusBadge>;
        if (captureStatus === 'skipped') return <StatusBadge tone="default">跳过</StatusBadge>;
        if (captureStatus === 'error') return <StatusBadge tone="failed">打开失败</StatusBadge>;
        return <StatusBadge tone="default">{captureStatus || '未知'}</StatusBadge>;
      },
    },
    {
      title: '学校状态',
      dataIndex: 'schoolStatus',
      key: 'schoolStatus',
      width: 140,
      align: 'center',
      render: schoolStatusBadge,
    },
  ];

  const expandedRowRender = (record) => {
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
    <Modal
      title={title}
      open={open}
      footer={null}
      onCancel={onClose}
      width="min(1120px, 94vw)"
      destroyOnClose
    >
      <div style={{ marginBottom: 12, color: '#4b5563' }}>
        {result ? (
          <>
            <strong>{result.studentNo}</strong>
            {result.realName ? ` ${result.realName}` : ''}
            {' · '}
            已截图 {result.summary?.capturedExperimentCount || 0} 个
            {' · '}
            跳过 {result.summary?.skippedExperimentCount || 0} 个
            {' · '}
            打开失败 {result.summary?.errorExperimentCount || 0} 个
          </>
        ) : '正在生成截图...'}
      </div>
      {loading && !result ? (
        <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : (
        <Table
          loading={loading}
          columns={columns}
          dataSource={result?.experiments || []}
          rowKey="experimentId"
          pagination={false}
          size="small"
          scroll={{ y: '68vh' }}
          expandable={{
            expandedRowRender,
            rowExpandable: () => true,
          }}
        />
      )}
    </Modal>
  );
}
