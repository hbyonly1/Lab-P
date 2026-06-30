import React, { useState, useEffect } from 'react';
import { Modal, Button, message } from 'antd';
import { CrownOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { ExperimentImageUploader } from './ExperimentImageUploader.jsx';
import { PaywallModal } from '../ui/index.js';
import { getDebugServiceRole } from '../../pages/workspace/debugRoleStore.js';

/**
 * 一键提交 (Pro) 专属复核弹窗
 * @param {boolean} open - 弹窗是否可见
 * @param {Array} experiments - 待提交的实验配置数组
 * @param {Function} onCancel - 取消回调
 * @param {Function} onSubmit - 确认提交回调
 */
export function ProSubmitModal({ open, experiments = [], onCancel, onSubmit }) {
  const [step, setStep] = useState(1);
  const [batchImageSlots, setBatchImageSlots] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [readyCount, setReadyCount] = useState(1);

  // 每次打开弹窗时，重置状态
  useEffect(() => {
    if (open) {
      setStep(1);
      setBatchImageSlots({});
      setIsSubmitting(false);
      setIsPaywallOpen(false);
    }
  }, [open]);

  // 处理图片上传
  const handleImageUpload = (expId, slotId, file) => {
    setBatchImageSlots(prev => {
      const expSlots = prev[expId] || {};
      const slotFiles = expSlots[slotId] || [];
      return {
        ...prev,
        [expId]: {
          ...expSlots,
          [slotId]: [
            ...slotFiles,
            {
              uid: file.uid || `${file.name}-${Date.now()}`,
              name: file.name,
              url: URL.createObjectURL(file),
              originFileObj: file
            }
          ]
        }
      };
    });
    return false; // 阻止默认上传
  };

  // 处理图片移除
  const handleRemoveImage = (expId, slotId, uidToRemove) => {
    setBatchImageSlots(prev => {
      const expSlots = prev[expId] || {};
      const slotFiles = expSlots[slotId] || [];
      return {
        ...prev,
        [expId]: {
          ...expSlots,
          [slotId]: slotFiles.filter(f => f.uid !== uidToRemove)
        }
      };
    });
  };

  // 获取某个实验上传的图片总数
  const getExperimentImageCount = (expId) => {
    const expSlots = batchImageSlots[expId] || {};
    return Object.values(expSlots).reduce((total, files) => total + files.length, 0);
  };

  const handleNextStep = () => {
    setStep(2);
  };

  const handlePrevStep = () => {
    setStep(1);
  };

  const handleFinalSubmit = async () => {
    // 过滤出真正需要提交的实验
    const count = experiments.filter(e => getExperimentImageCount(e.id) > 0).length;
    if (count === 0) {
      message.warning('请至少上传一个实验的图片');
      return;
    }

    setIsSubmitting(true);
    try {
      if (onSubmit) {
        await onSubmit(batchImageSlots); // 此处模拟后台真实创建任务，初始状态可为 payment_pending
      }

      const debugRole = getDebugServiceRole();
      if (debugRole === 'pro') {
        message.success('提交成功！任务已进入人工审核队列。');
        onCancel();
      } else {
        setReadyCount(count);
        setIsPaywallOpen(true);
      }
    } catch (e) {
      console.error(e);
      message.error('提交失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaywallClose = (isHungup) => {
    setIsPaywallOpen(false);
    if (isHungup === true) {
      setTimeout(() => {
        onCancel(); // 只有真正挂起订单时，才关闭底层的上传弹窗
        Modal.info({
          title: '订单已挂起',
          content: '您的任务订单已提交并处于待付款挂起状态。请确保已扫码支付，管理员核实后，您的实验将自动进入处理队列。如有疑问，请联系管理员，QQ:1952096193',
          okText: '知道了'
        });
      }, 10);
    }
  };

  // ================= 渲染视图 =================

  const renderStep1 = () => (
    <div className="pro-submit-step1">
      <div style={{ marginBottom: 16, color: '#696969' }}>
        请分别上传实验对应的原始数据记录，无需担心任何事情，我们会接管后续所有流程。
      </div>
      <div style={{ maxHeight: '50vh', overflowY: 'auto', paddingRight: '8px' }}>
        {experiments.map(exp => (
          <div key={exp.id} style={{ marginBottom: '24px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0, color: '#141413', fontSize: '15px' }}>
              {exp.name} - 签字原始数据上传
            </h3>
            <ExperimentImageUploader
              images={exp.inputs?.images || []}
              imageSlots={batchImageSlots[exp.id] || {}}
              onImageUpload={(slotId, file) => handleImageUpload(exp.id, slotId, file)}
              onRemoveImage={(slotId, uid) => handleRemoveImage(exp.id, slotId, uid)}
              recognitionDef={null} // 屏蔽 AI 一键识别按钮，弹窗内仅做上传
            />
          </div>
        ))}
        {experiments.length === 0 && (
          <div style={{ color: '#999', textAlign: 'center', padding: '20px' }}>暂无待提交的实验</div>
        )}
      </div>
    </div>
  );

  const renderStep2 = () => {
    return (
      <div className="pro-submit-step2">
        <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: 600 }}>即将提交</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0', background: '#f8fafc', borderRadius: '8px', overflow: 'hidden' }}>
          {experiments.map((exp, index) => {
            const count = getExperimentImageCount(exp.id);
            const isSubmittingExp = count > 0;
            return (
              <li key={exp.id} style={{
                padding: '12px 16px',
                borderBottom: index < experiments.length - 1 ? '1px solid #e1e7f0' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '15px', color: '#333' }}>{exp.name}</span>
                {isSubmittingExp ? (
                  <span style={{ color: '#52c41a', fontWeight: 500 }}>{count} 张图片</span>
                ) : (
                  <span style={{ color: '#faad14', fontWeight: 500 }}>不提交 (留空)</span>
                )}
              </li>
            );
          })}
        </ul>

        <div style={{
          marginTop: '24px',
          padding: '12px 16px',
          background: '#fff2f0',
          border: '1px solid #ffccc7',
          borderRadius: '6px',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start'
        }}>
          <ExclamationCircleOutlined style={{ color: '#ff4d4f', fontSize: '16px', marginTop: '2px' }} />
          <span style={{ color: '#cf1322', fontSize: '14px', lineHeight: 1.5 }}>
            <strong>警告：</strong> 选择提交的实验将会覆写系统中已存在的数据，进入后台人工复核流程并正式提交，正式提交后你无需任何操作！此操作不可逆，请再三确认！
          </span>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c49021' }}>
          <CrownOutlined /> {step === 1 ? '一键批量提交 - 上传数据' : '一键批量提交 - 最终确认'}
        </span>
      }
      onCancel={!isSubmitting ? onCancel : undefined}
      closable={!isSubmitting}
      maskClosable={!isSubmitting}
      width={700}
      footer={
        step === 1 ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button onClick={onCancel}>取消</Button>
            <Button
              className="recognize-primary-button"
              type="primary"
              onClick={handleNextStep}
              disabled={experiments.length === 0}
            >
              下一步，确认清单
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <Button onClick={handlePrevStep} disabled={isSubmitting}>返回修改</Button>
            <Button
              className="recognize-primary-button"
              type="primary"
              danger
              onClick={handleFinalSubmit}
              loading={isSubmitting}
            >
              确认正式提交
            </Button>
          </div>
        )
      }
    >
      {step === 1 ? renderStep1() : renderStep2()}

      <PaywallModal
        open={isPaywallOpen}
        onCancel={handlePaywallClose}
        taskCount={readyCount}
      />
    </Modal>
  );
}
