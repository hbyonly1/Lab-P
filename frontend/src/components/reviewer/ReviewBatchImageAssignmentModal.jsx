import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Image, Modal, Spin, Tag, message } from 'antd';
import { PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { ExperimentImageUploader, resolveImageUrl } from '../experiment/ExperimentImageUploader.jsx';
import { experimentsApi } from '../../services/experimentsApi.js';
import {
  getSubmission,
  prepareSubmissionBatchForReview,
  saveSubmissionImageSlots,
} from '../../services/submissionsApi.js';
import { uploadFile } from '../../services/uploadApi.js';

const normalizeSlots = (slots = {}) => {
  const normalized = {};
  Object.entries(slots || {}).forEach(([slotId, rawItems]) => {
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    const files = items
      .map((item) => {
        if (typeof item === 'string') return { url: item };
        return item && item.url ? item : null;
      })
      .filter(Boolean);
    if (files.length) normalized[slotId] = files;
  });
  return normalized;
};

export function ReviewBatchImageAssignmentModal({ open, batch, onClose, onFinished }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [configs, setConfigs] = useState({});
  const [activeSubmissionId, setActiveSubmissionId] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [assignments, setAssignments] = useState({});

  useEffect(() => {
    if (!open || !batch) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setSelectedImage(null);
      try {
        const batchExperiments = batch?.experiments || [];
        const details = await Promise.all(batchExperiments.map((exp) => getSubmission(exp.submission_id)));
        const uniqueExperimentIds = [...new Set(batchExperiments.map((exp) => exp.id))];
        const configEntries = await Promise.all(
          uniqueExperimentIds.map(async (experimentId) => [experimentId, await experimentsApi.getExperimentConfig(experimentId)])
        );
        if (cancelled) return;
        const nextConfigs = Object.fromEntries(configEntries);
        const nextAssignments = {};
        details.forEach((submission) => {
          nextAssignments[submission.id] = normalizeSlots(submission.image_slots);
        });
        setSubmissions(details);
        setConfigs(nextConfigs);
        setAssignments(nextAssignments);
        setActiveSubmissionId(details[0]?.id || null);
      } catch (error) {
        if (!cancelled) message.error(error.response?.data?.detail || '加载批次图片失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, batch]);

  const activeSubmission = useMemo(
    () => submissions.find((submission) => submission.id === activeSubmissionId),
    [submissions, activeSubmissionId]
  );

  const activeConfig = activeSubmission ? configs[activeSubmission.experiment_id] : null;
  const imageSlots = activeConfig?.inputs?.images || [];
  const activeBatchExperiment = (batch?.experiments || []).find((item) => item.submission_id === activeSubmission?.id);
  const activeExperimentName = activeConfig?.meta?.name || activeConfig?.meta?.title || activeBatchExperiment?.name || activeSubmission?.experiment_id;
  const primaryImageTitle = imageSlots[0]?.label || imageSlots[0]?.title || '签字原始数据上传';
  const uploaderTitle = activeExperimentName ? `${activeExperimentName} - ${primaryImageTitle}` : primaryImageTitle;
  const uploadedImages = (activeSubmission?.image_paths || []).map((url, index) => ({
    uid: `${activeSubmission.id}-${index}`,
    url,
    name: `图片 ${index + 1}`,
    sourceIndex: index + 1,
  }));
  const usedImageUrls = useMemo(() => {
    const urls = new Set();
    Object.values(assignments).forEach((slots) => {
      Object.values(slots || {}).forEach((items) => {
        (items || []).forEach((item) => {
          if (item?.url) urls.add(item.url);
        });
      });
    });
    return urls;
  }, [assignments]);

  const saveAssignments = async () => {
    setSaving(true);
    try {
      await Promise.all(
        submissions.map((submission) => (
          saveSubmissionImageSlots(submission.id, assignments[submission.id] || {})
        ))
      );
      message.success('图片匹配已保存');
      onFinished?.();
    } catch (error) {
      message.error(error.response?.data?.detail || '保存图片匹配失败');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const prepareBatch = async () => {
    setSaving(true);
    try {
      await prepareSubmissionBatchForReview(batch.batch_id, assignments);
      message.success('批量预处理已启动');
      onFinished?.();
      onClose?.();
    } catch (error) {
      message.error(error.response?.data?.detail || '启动预处理失败');
    } finally {
      setSaving(false);
    }
  };

  const placeImageIntoSlot = (slotId, image = selectedImage) => {
    if (!activeSubmission || !image) {
      message.warning('请先选择一张图片');
      return;
    }
    setAssignments((prev) => ({
      ...prev,
      [activeSubmission.id]: {
        ...(prev[activeSubmission.id] || {}),
        [slotId]: [image],
      },
    }));
  };

  const uploadImageIntoSlot = async (slotId, file) => {
    if (!activeSubmission) return false;
    message.loading({ content: '正在上传...', key: `review-upload-${file.uid || file.name}` });
    try {
      const uploaded = await uploadFile(file);
      setAssignments((prev) => ({
        ...prev,
        [activeSubmission.id]: {
          ...(prev[activeSubmission.id] || {}),
          [slotId]: [
            ...((prev[activeSubmission.id] || {})[slotId] || []),
            {
              uid: file.uid || `${slotId}-${Date.now()}`,
              name: file.name,
              url: uploaded.url,
              originFileObj: file,
            },
          ],
        },
      }));
      message.success({ content: '上传成功', key: `review-upload-${file.uid || file.name}` });
    } catch (error) {
      message.error({ content: error.message || '上传失败', key: `review-upload-${file.uid || file.name}` });
    }
    return false;
  };

  const replaceImageInSlot = async (slotId, uidToReplace, file) => {
    if (!activeSubmission) return false;
    message.loading({ content: '正在旋转并上传...', key: `review-rotate-${uidToReplace}` });
    try {
      const uploaded = await uploadFile(file);
      setAssignments((prev) => ({
        ...prev,
        [activeSubmission.id]: {
          ...(prev[activeSubmission.id] || {}),
          [slotId]: ((prev[activeSubmission.id] || {})[slotId] || []).map((item) => (
            item.uid === uidToReplace
              ? { ...item, name: file.name, url: uploaded.url, originFileObj: file }
              : item
          )),
        },
      }));
      message.success({ content: '图片已旋转并保存', key: `review-rotate-${uidToReplace}` });
      return true;
    } catch (error) {
      message.error({ content: error.message || '旋转失败', key: `review-rotate-${uidToReplace}` });
      return false;
    }
  };

  const removeSlotImage = (slotId) => {
    if (!activeSubmission) return;
    setAssignments((prev) => {
      const nextSlots = { ...(prev[activeSubmission.id] || {}) };
      delete nextSlots[slotId];
      return { ...prev, [activeSubmission.id]: nextSlots };
    });
  };

  return (
    <Modal
      rootClassName="pro-submit-modal-root"
      className="pro-submit-fullscreen-modal review-image-match-modal"
      title={
        <div className="pro-submit-modal-title">
          <span>图片匹配与批量预处理</span>
        </div>
      }
      open={open}
      width="100vw"
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" icon={<SaveOutlined />} loading={saving} onClick={saveAssignments}>保存草稿</Button>,
        <Button key="prepare" type="primary" icon={<PlayCircleOutlined />} loading={saving} onClick={prepareBatch}>
          确认匹配并开始处理
        </Button>,
      ]}
      destroyOnClose
    >
      {loading ? (
        <div style={{ height: 420, display: 'grid', placeItems: 'center' }}>
          <Spin />
        </div>
      ) : (
        <div className="review-batch-assignment">
          <aside className="review-batch-assignment-list">
            {submissions.map((submission) => {
              const exp = (batch?.experiments || []).find((item) => item.submission_id === submission.id);
              const slotCount = Object.values(assignments[submission.id] || {}).reduce((sum, items) => sum + items.length, 0);
              return (
                <button
                  key={submission.id}
                  type="button"
                  className={`review-batch-assignment-item ${submission.id === activeSubmissionId ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveSubmissionId(submission.id);
                    setSelectedImage(null);
                  }}
                >
                  <span>{exp?.name || submission.experiment_id}</span>
                  <Tag color={slotCount > 0 ? 'green' : 'default'}>{slotCount > 0 ? '已匹配' : '未匹配'}</Tag>
                </button>
              );
            })}
          </aside>
          <section className="review-batch-assignment-workspace">
            <div className="review-batch-image-pool">
              <div className="review-batch-panel-title">学生上传图片</div>
              {uploadedImages.length ? uploadedImages.map((image) => (
                <button
                  key={image.uid}
                  type="button"
                  className={`review-batch-image-thumb ${selectedImage?.url === image.url ? 'is-selected' : ''}`}
                  onClick={() => setSelectedImage(image)}
                  draggable
                  onDragStart={(event) => {
                    const payload = JSON.stringify(image);
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/json', payload);
                    event.dataTransfer.setData('text/plain', payload);
                  }}
                >
                  <Image src={resolveImageUrl(image.url)} preview={false} />
                  <span>{image.name}</span>
                  {usedImageUrls.has(image.url) && <Tag color="green">已使用</Tag>}
                </button>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片" />}
            </div>
            <div className="review-batch-slot-panel">
              {imageSlots.length ? (
                <ExperimentImageUploader
                  images={imageSlots}
                  imageSlots={assignments[activeSubmission?.id] || {}}
                  onImageUpload={uploadImageIntoSlot}
                  onImageReplace={replaceImageInSlot}
                  onExternalImageDrop={placeImageIntoSlot}
                  onRemoveImage={removeSlotImage}
                  recognitionDef={null}
                  title={uploaderTitle}
                  emptyTitle="拖动左侧图片到这里"
                  emptyHint="这里复用实验详情页的图片槽组件，支持预览、缩放、旋转和移除。"
                  className="is-inline-image-node review-batch-slot-uploader"
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该实验未配置图片槽" />}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
