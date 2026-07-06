import React, { useState, useEffect } from 'react';
import { Modal, Button, message, Input } from 'antd';
import { CrownOutlined } from '@ant-design/icons';
import { getAdminUserRole } from '../../auth.js';
import { uploadFile } from '../../services/uploadApi.js';
import { ExperimentImageUploader } from './ExperimentImageUploader.jsx';
import { PaywallModal } from '../ui/index.js';

/**
 * 一键提交 (Pro) 专属复核弹窗
 * @param {boolean} open - 弹窗是否可见
 * @param {Array} experiments - 待提交的实验配置数组
 * @param {Function} onCancel - 取消回调
 * @param {Function} onSubmit - 确认提交回调
 */
export function ProSubmitModal({ open, experiments: propExperiments, onCancel, onSubmit }) {
  const [experiments, setExperiments] = useState(propExperiments || []);
  const [activeExperimentId, setActiveExperimentId] = useState(null);
  const [batchImageSlots, setBatchImageSlots] = useState({});
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [readyCount, setReadyCount] = useState(1);
  const [targetStudent, setTargetStudent] = useState('');

  const userRole = getAdminUserRole();

  // 每次打开弹窗时，重置状态并同步传入的实验数据
  useEffect(() => {
    if (open) {
      const nextExperiments = propExperiments || [];
      setStep(1);
      setExperiments(nextExperiments);
      setActiveExperimentId(nextExperiments[0]?.id || null);
      setBatchImageSlots({});
      setIsSubmitting(false);
      setIsPaywallOpen(false);
      setTargetStudent('');
    }
  }, [open, propExperiments]);

  // 处理图片真实上传
  const handleImageUpload = async (expId, slotId, file) => {
    const uid = file.uid || `${file.name}-${Date.now()}`;
    message.loading({ content: '正在上传...', key: `upload-${uid}` });
    try {
      const res = await uploadFile(file);
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
                uid: uid,
                name: file.name,
                url: res.url, // Real URL from server
                originFileObj: file
              }
            ]
          }
        };
      });
      message.success({ content: '上传成功', key: `upload-${uid}` });
    } catch (e) {
      message.error({ content: '上传失败', key: `upload-${uid}` });
    }
    return false; // 阻止默认自动上传动作
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

  const activeExperimentIndex = Math.max(0, experiments.findIndex(exp => exp.id === activeExperimentId));
  const activeExperiment = experiments[activeExperimentIndex] || experiments[0] || null;

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
        await onSubmit(batchImageSlots, targetStudent, false);
      }
      message.success('提交成功！任务已进入人工审核队列。');
      onCancel();
    } catch (e) {
      console.error(e);
      if (e.response?.status === 403 || e.status === 403) {
        setReadyCount(count);
        setIsPaywallOpen(true);
        return;
      }
      const msg = e.response?.data?.detail || e.message;
      message.error(`提交失败: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaywallClose = async (isHungup, planName) => {
    setIsPaywallOpen(false);
    if (isHungup === true) {
      setIsSubmitting(true);
      try {
        if (onSubmit) {
          await onSubmit(batchImageSlots, targetStudent, true, planName); // pass planName
        }
        setTimeout(() => {
          onCancel(); // 只有真正挂起订单时，才关闭底层的上传弹窗
          Modal.info({
            title: '订单已挂起',
            content: '您的任务订单已提交并处于待付款挂起状态。请确保已扫码支付，管理员核实后，您的实验将自动进入处理队列。如有疑问，请联系管理员，QQ:1952096193',
            okText: '知道了'
          });
        }, 10);
      } catch (e) {
        console.error(e);
        const msg = e.response?.data?.detail || e.message;
        message.error(`提交失败: ${msg}`);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // ================= 渲染视图 =================

  const renderStep1 = () => (
    <div className="pro-submit-step1">
      {experiments.length > 0 ? (
        <div className="pro-submit-upload-layout">
          <div className="pro-submit-experiment-list">
            {experiments.map((exp, index) => {
              const imageCount = getExperimentImageCount(exp.id);
              const isActive = activeExperiment?.id === exp.id;
              return (
                <button
                  key={exp.id}
                  type="button"
                  className={`pro-submit-experiment-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setActiveExperimentId(exp.id)}
                >
                  <span className="pro-submit-experiment-index">{index + 1}</span>
                  <span className="pro-submit-experiment-main">
                    <strong>{exp.name}</strong>
                    <span className={imageCount > 0 ? 'is-ready' : ''}>
                      {imageCount > 0 ? `已上传 ${imageCount} 张` : '未上传'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pro-submit-active-panel">
            <div className="pro-submit-active-head">
              <h3>{activeExperiment?.name} - 签字原始数据上传</h3>
            </div>
            <ExperimentImageUploader
              images={activeExperiment?.inputs?.images || []}
              imageSlots={batchImageSlots[activeExperiment?.id] || {}}
              onImageUpload={(slotId, file) => handleImageUpload(activeExperiment.id, slotId, file)}
              onRemoveImage={(slotId, uid) => handleRemoveImage(activeExperiment.id, slotId, uid)}
              recognitionDef={null} // 屏蔽 AI 一键识别按钮，弹窗内仅做上传
            />
          </div>
        </div>
      ) : (
        <div style={{ color: '#999', textAlign: 'center', padding: '20px' }}>暂无待提交的实验</div>
      )}
    </div>
  );

  const renderStep2 = () => {
    return (
      <div className="pro-submit-step2">
        <div className="pro-submit-confirm-head">
          <h3>即将提交</h3>
        </div>

        <div className="pro-submit-confirm-list-shell">
          <ul className="pro-submit-confirm-list">
            {experiments.map((exp) => {
              const count = getExperimentImageCount(exp.id);
              const isSubmittingExp = count > 0;
              return (
                <li key={exp.id} className="pro-submit-confirm-row">
                  <span className="pro-submit-confirm-name">{exp.name}</span>
                  <span className={`pro-submit-confirm-pill ${isSubmittingExp ? 'is-ready' : 'is-empty'}`}>
                    {isSubmittingExp ? `${count} 张图片` : '不提交 (留空)'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="pro-submit-confirm-bottom">
          {['admin', 'reviewer'].includes(userRole) && (
            <div className="pro-submit-admin-handoff">
              <div>管理员代交设置 (可选)</div>
              <Input
                placeholder="请输入代交的目标学号，留空则绑定在当前账号下"
                value={targetStudent}
                onChange={(e) => setTargetStudent(e.target.value)}
              />
            </div>
          )}

          <div className="pro-submit-confirm-warning">
            <strong>警告：</strong> 选择提交的实验将会覆写系统中已存在的数据，进入后台人工复核流程并正式提交，正式提交后你无需任何操作！此操作不可逆，请再三确认！
          </div>
        </div>
      </div>
    );
  };

  return (
    <Modal
      rootClassName="pro-submit-modal-root"
      className={`pro-submit-fullscreen-modal ${step === 1 ? 'is-upload-step' : 'is-confirm-step'}`}
      open={open}
      title={
        <div className="pro-submit-modal-title">
          <span>
            <CrownOutlined /> 一键批量提交 - 上传数据
          </span>
          <p>请分别上传实验对应的原始数据记录，无需担心任何事情，我们会接管后续所有流程。</p>
        </div>
      }
      onCancel={!isSubmitting ? onCancel : undefined}
      closable={!isSubmitting}
      maskClosable={!isSubmitting}
      width="100vw"
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
