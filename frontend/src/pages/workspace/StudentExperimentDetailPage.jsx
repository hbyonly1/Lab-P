import { useEffect, useMemo, useState } from 'react';
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
import { getExperimentConfig, initFixedValues } from '../../services/experimentConfigStore.js';
import { GoldButton, LockedNotice, StatusBadge } from '../../components/ui/index.js';
import { SectionShell, ExperimentDataTable, ExperimentImageUploader } from '../../components/experiment/index.js';
import {
  getDebugServiceCapabilities,
  getDebugServiceRole,
  subscribeDebugServiceRole,
} from './debugRoleStore.js';

// Extracted components are imported from components/experiment/index.js

export default function StudentExperimentDetailPage() {
  const { experimentId } = useParams();
  const navigate = useNavigate();

  // 严格加载 V2 配置，禁止向下兼容与默认兜底
  const experiment = useMemo(
    () => getExperimentConfig(experimentId),
    [experimentId],
  );

  if (!experiment) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#fafafc' }}>
        <h1 style={{ fontSize: '48px', color: '#ff4d4f', margin: '0' }}>403</h1>
        <h2 style={{ color: '#141413' }}>配置未授权或不兼容</h2>
        <p style={{ color: '#696969', maxWidth: '400px', margin: '16px auto' }}>
          此系统已升级为纯正的 V2 架构。当前请求的实验配置不属于 V2 标准或不存在。旧版的实验由于前端逻辑的废除已被强制拦截。
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

export function ExperimentDetailView({ experiment, onBack }) {
  const [debugRole, setDebugRole] = useState(() => getDebugServiceRole());

  // 核心状态：所有的节点值都在这个 formValues 里
  const [formValues, setFormValues] = useState(() => initFixedValues(experiment.inputs.fields));
  const [isComputing, setIsComputing] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);

  // 图片槽位状态映射：{ "IMG_RAW": [file1, file2], "IMG_WAVE": [file3] }
  const [imageSlots, setImageSlots] = useState({});

  useEffect(() => subscribeDebugServiceRole(setDebugRole), []);

  const status = { label: '待处理', tone: 'pending' }; // Mock status
  const capabilities = getDebugServiceCapabilities(debugRole);

  const handleFieldChange = (nodeId, value) => {
    setFormValues(prev => ({ ...prev, [nodeId]: value }));
  };

  const handleImageUpload = (slotId, file) => {
    setImageSlots(prev => {
      const currentSlotFiles = prev[slotId] || [];
      const slotDef = experiment.inputs.images.find(s => s.id === slotId);
      if (slotDef?.maxCount && currentSlotFiles.length >= slotDef.maxCount) {
        message.warning(`该区域最多上传 ${slotDef.maxCount} 张图片`);
        return prev;
      }
      return {
        ...prev,
        [slotId]: [...currentSlotFiles, { ...file, url: URL.createObjectURL(file) }]
      };
    });
    return false; // 阻止默认上传
  };

  // --- 后端计算通用接口 (Mock) ---
  const handleCompute = () => {
    if (!capabilities.canUseAssistedFill) {
      message.warning('权限拒绝：该功能需要 Plus/Pro 订阅。');
      return;
    }
    setIsComputing(true);
    message.loading({ content: '正在请求计算，请耐心等待...', key: 'compute' });
    // 模拟调用后端 POST /api/experiments/{exp_id}/compute (带鉴权签名)
    setTimeout(() => {
      setFormValues(prev => {
        const next = { ...prev };
        // 这里仅作演示，实际由后端执行 DAG 推导并返回全量更新
        if (next['A'] && next['D']) next['B'] = String(Number(next['A']) + Number(next['D']));
        if (next['E'] && next['F']) next['C'] = String(Number(next['E']) * Number(next['F']));
        if (next['B'] && next['C']) next['Result'] = String(Number(next['B']) - Number(next['C']));

        // 牛顿环 Mock 计算
        if (next['N10-0']) {
          next['N4'] = String(parseFloat(next['N10-0']) * 2.5);
        }
        return next;
      });
      setIsComputing(false);
      message.success({ content: `尊贵的 ${debugRole === 'pro' ? 'Pro' : 'Plus'} 用户，待计算的填空已经过公式计算并填入！`, key: 'compute' });
    }, 1500);
  };

  // --- 后端自动填空接口 (Mock) ---
  const handleAssistedFill = () => {
    if (!capabilities.canUseAssistedFill) {
      message.warning('权限拒绝：该功能需要 Plus/Pro 订阅。');
      return;
    }
    setIsFilling(true);
    // 模拟调用后端 GET /api/experiments/{exp_id}/fixed-params (带鉴权签名)
    setTimeout(() => {
      setFormValues(prev => {
        const next = { ...prev };
        // 因为当前的 JSON 中没有固定的 seg.value，这里使用 Hardcode Mock
        // 实际上后端会从数据库中读取这个实验的标准常量配置并返回
        const mockFixedParams = {
          "SYMD_Fill_0": "电压表和欧姆表",
          "SYMD_Fill_1": "1500",
          "SYMD_Fill_2": "电阻 Rx",
          "SYYL_Fill_0": "1500"
        };
        Object.assign(next, mockFixedParams);
        return next;
      });
      setIsFilling(false);
      message.success(`尊贵的 ${debugRole === 'pro' ? 'Pro' : 'Plus'} 用户，已填入，请核对！`);
    }, 1000);
  };

  // --- AI 图像识别 (Mock) ---
  const handleRecognize = () => {
    const targetSlot = experiment.ai?.recognition?.imageRef;
    if (!targetSlot || !imageSlots[targetSlot] || imageSlots[targetSlot].length === 0) {
      message.warning('请先在相应的区域上传图片');
      return;
    }
    if (!capabilities.canUseRecognition) {
      message.warning('权限拒绝：该功能需要 Pro 订阅。');
      return;
    }

    setIsRecognizing(true);
    message.loading({ content: '正在请求大模型，请耐心等待...', key: 'recognize' });
    // 模拟向后端发送图片和 prompt
    setTimeout(() => {
      setFormValues(prev => ({
        ...prev, "Ig": "100", "Rg": "1500", "E": "1.5", "V_std_1": "2.0", "V_mod_1": "1.98"
      }));
      setIsRecognizing(false);
      message.success({ content: `尊贵的 ${debugRole === 'pro' ? 'Pro' : 'Plus'} 用户，识别完成！已自动填写数据到表格，请核对！`, key: 'recognize' });
    }, 2000);
  };

  // --- AI 自动生成解答 (Mock) ---
  const handleGenerateAnswer = (nodeId) => {
    if (!capabilities.canUseAssistedFill) {
      message.warning('权限拒绝：该功能需要 Plus/Pro 订阅。');
      return;
    }
    // 模拟调用后端 POST /api/experiments/{exp_id}/generate (带鉴权签名与频控)
    message.loading({ content: '正在请求大模型，请耐心等待...', key: 'gen-answer' });
    setTimeout(() => {
      setFormValues(prev => ({
        ...prev,
        [nodeId]: "这涉及到光在光疏介质和光密介质表面的反射特性。根据电磁波理论，当光从光疏介质射向光密介质并在交界面发生反射时，反射光会发生半个波长的相位突变，即半波损失。"
      }));
      message.success({ content: `尊贵的 ${debugRole === 'pro' ? 'Pro' : 'Plus'} 用户，已生成解答，请核对！`, key: 'gen-answer' });
    }, 1500);
  };

  const handleOneClickSubmit = () => {
    if (!capabilities.canUseOneClickSubmit) {
      message.warning('权限拒绝：该功能需要 Pro 订阅。');
      return;
    }
    message.success('尊贵的 Pro 用户，您的请求已提交，请耐心等待后台人工审核！');
  };

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
          <Button icon={<SaveOutlined />} style={{ background: '#fff' }}>临时提交</Button>
          <Button type="primary" icon={<SendOutlined />}>正式提交</Button>
          <GoldButton onClick={handleOneClickSubmit} icon={<CrownOutlined />}>
            一键提交<span className="pro-fill-badge">(Pro)</span>
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
              一键填空 (Plus/Pro)
            </Button>
          }
        >
          <div className="fixed-sections-grid">
            {experiment.ui.fixedSections?.map((section, idx) => (
              <div key={idx}>
                {section.title && <h3 className="fixed-section-title">{section.title}</h3>}
                <p className="fixed-section-content">
                  {section.segments.map((seg, sIdx) => {
                    if (typeof seg === 'string') return <span key={sIdx} style={{ whiteSpace: 'pre-wrap' }}>{seg}</span>;
                    if (seg.type === 'image') {
                      if (seg.inline) {
                        return (
                          <img
                            key={sIdx}
                            src={seg.src}
                            alt=""
                            style={{ width: seg.width, height: seg.height, verticalAlign: 'middle', margin: '0 4px' }}
                            draggable={false}
                          />
                        );
                      }
                      return (
                        <div key={sIdx} style={{ margin: '16px 0', width: '100%', textAlign: 'center' }}>
                          <img src={seg.src} alt="" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }} draggable={false} />
                        </div>
                      );
                    }

                    const nodeId = seg.nodeId;
                    const isComputed = experiment.metaInfo?.computedIds?.has(nodeId);
                    const isAsync = experiment.metaInfo?.asyncIds?.has(nodeId);
                    const isFixed = experiment.metaInfo?.fixedIds?.has(nodeId);

                    return (
                      <input
                        key={sIdx}
                        className={`fixed-inline-input ${isComputed ? 'is-computed' : ''} ${isAsync ? 'is-async' : ''} ${isFixed ? 'is-fixed' : ''}`}
                        style={{ width: seg.width || '60px', margin: '0 8px' }}
                        readOnly={isFixed}
                        placeholder={isComputed ? '待计算' : ''}
                        value={formValues[nodeId] ?? ''}
                        onChange={e => handleFieldChange(nodeId, e.target.value)}
                        title={`节点: ${nodeId}`}
                      />
                    );
                  })}
                </p>
              </div>
            ))}
          </div>
        </SectionShell>

        {/* 区域 2：数据表格与图片 */}
        <SectionShell index="2." title="实验处理">
          <div className="experiment-data-grid">
            {/* 左侧：动态表格 */}
            <div className="experiment-data-wrapper">
              {experiment.ui.dataTable ? (
                <ExperimentDataTable
                  dataTable={experiment.ui.dataTable}
                  formValues={formValues}
                  onFieldChange={handleFieldChange}
                  metaInfo={experiment.metaInfo}
                />
              ) : (
                <div style={{ color: '#696969' }}>此实验无需填写实验处理。</div>
              )}
            </div>

            {/* 右侧：图片插槽与 AI */}
            <div className="experiment-image-panel">
              <ExperimentImageUploader
                images={experiment.inputs.images}
                imageSlots={imageSlots}
                onImageUpload={handleImageUpload}
                onRecognize={handleRecognize}
                isRecognizing={isRecognizing}
                canUseRecognition={capabilities.canUseRecognition}
                recognitionDef={experiment.ai?.recognition}
                onRemoveImage={(slotId, uid) => {
                  setImageSlots(prev => ({
                    ...prev,
                    [slotId]: prev[slotId].filter(f => f.uid !== uid)
                  }));
                }}
              />
            </div>
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
                          一键计算数据 (Plus/Pro)
                        </Button>
                      </div>
                    )}
                    <div className="fixed-section-content">
                      {section.segments.map((seg, sIdx) => {
                        if (typeof seg === 'string') return <span key={sIdx} style={{ whiteSpace: 'pre-wrap' }}>{seg}</span>;
                        if (seg.type === 'image') {
                          if (seg.inline) {
                            return (
                              <img
                                key={sIdx}
                                src={seg.src}
                                alt=""
                                style={{ width: seg.width, height: seg.height, verticalAlign: 'middle', margin: '0 4px' }}
                                draggable={false}
                              />
                            );
                          }
                          return (
                            <div key={sIdx} style={{ margin: '16px 0', width: '100%', textAlign: 'center' }}>
                              <img src={seg.src} alt="" style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }} draggable={false} />
                            </div>
                          );
                        }
                        const isComputed = experiment.metaInfo?.computedIds?.has(seg.nodeId);
                        const isFixed = experiment.metaInfo?.fixedIds?.has(seg.nodeId);
                        return (
                          <input
                            key={sIdx}
                            className={`fixed-inline-input ${isComputed ? 'is-computed' : ''}`}
                            style={{ width: seg.width || '80px', margin: '0 8px' }}
                            placeholder={isComputed ? '待计算' : ''}
                            readOnly={isFixed}
                            value={formValues[seg.nodeId] ?? ''}
                            onChange={e => handleFieldChange(seg.nodeId, e.target.value)}
                            title={`节点: ${seg.nodeId}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionShell>

        {/* 区域 3：实验问题 */}
        <SectionShell index="3." title="实验分析与拓展">
          <div className="experiment-questions-section" style={{ background: '#fff', border: '1px solid #e1e7f0', borderRadius: '12px', padding: '24px' }}>
            {experiment.ui.questions?.map(q => (
              <div key={q.nodeId} className="question-item" style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '15px', marginBottom: '12px', color: '#141413' }}>{q.title}</h4>
                <Input.TextArea
                  className="question-textarea"
                  rows={q.rows || 4}
                  placeholder={q.placeholder || '请详细作答...'}
                  value={formValues[q.nodeId] ?? ''}
                  onChange={e => handleFieldChange(q.nodeId, e.target.value)}
                  style={{ marginBottom: '12px', backgroundColor: '#fff' }}
                />
                <div className="question-actions">
                  <Button className="recognize-primary-button" type="primary" icon={<CrownOutlined />} onClick={() => handleGenerateAnswer(q.nodeId)}>
                    一键填入生成式回答 (Plus/Pro)
                  </Button>
                </div>
              </div>
            ))}
            {(!experiment.ui.questions || experiment.ui.questions.length === 0) && (
              <span style={{ color: '#696969' }}>此实验无需填写实验分析与拓展。</span>
            )}
          </div>
        </SectionShell>
      </div>
    </section>
  );
}


