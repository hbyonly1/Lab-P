import React, { useState } from 'react';
import { Button, Upload, message } from 'antd';
import {
  CloudUploadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CameraOutlined,
  RotateRightOutlined
} from '@ant-design/icons';
import { apiClient } from '../../services/apiClient.js';

export const resolveImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/')) {
    return `${apiClient.defaults.baseURL || 'http://localhost:8000'}${url}`;
  }
  return url;
};

function RecognizeIcon() {
  return (
    <span className="recognize-scan-icon" aria-hidden="true">
      <span className="scan-corner is-tl" />
      <span className="scan-corner is-tr" />
      <CameraOutlined />
      <span className="scan-corner is-bl" />
      <span className="scan-corner is-br" />
    </span>
  );
}

export const imageUrlToFile = async (image, fileName) => {
  const response = await fetch(resolveImageUrl(image.url));
  if (!response.ok) throw new Error('图片读取失败');
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/png' });
};

export const rotateImageFile = async (file) => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close?.();

  const outputType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('图片旋转失败'));
    }, outputType, 0.92);
  });

  const extension = outputType === 'image/jpeg' ? 'jpg' : 'png';
  const baseName = file.name?.replace(/\.[^.]+$/, '') || 'rotated-image';
  return new File([blob], `${baseName}-rotated.${extension}`, { type: outputType });
};

export function ExperimentImageUploader({
  images,
  imageSlots,
  onImageUpload,
  onImageReplace,
  onExternalImageDrop,
  onRecognize,
  isRecognizing,
  canUseRecognition,
  recognitionDef,
  onRemoveImage,
  title = '签字原始数据上传',
  emptyTitle = '拖动文件到这里上传签字原始数据图片',
  emptyHint = '支持多张图片，可拖动或用鼠标滚轮缩放来对比信息',
  className = '',
}) {
  const allImages = images?.flatMap(slot =>
    (imageSlots[slot.id] || []).map(file => ({ ...file, slotId: slot.id, slotLabel: slot.label }))
  ) || [];

  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = allImages[activeIndex] || allImages[0];

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [isRotating, setIsRotating] = useState(false);

  const handleMouseDown = (event) => {
    if (!activeImage) return;
    setDragging(true);
    setDragStart({
      x: event.clientX - offset.x,
      y: event.clientY - offset.y,
    });
  };

  const handleMouseMove = (event) => {
    if (!dragging || !dragStart) return;
    setOffset({
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    });
  };

  const stopDragging = () => {
    setDragging(false);
    setDragStart(null);
  };

  const getDefaultSlotId = () => images?.[0]?.id || 'IMG_RAW';

  const handleExternalDrop = async (event) => {
    const rawPayload = event.dataTransfer?.getData('application/json') || event.dataTransfer?.getData('text/plain');
    if (!rawPayload || !onExternalImageDrop) return;

    let droppedImage = null;
    try {
      droppedImage = JSON.parse(rawPayload);
    } catch (error) {
      return;
    }

    if (!droppedImage?.url) return;
    event.preventDefault();
    event.stopPropagation();
    await onExternalImageDrop(getDefaultSlotId(), droppedImage);
  };

  const handleRotateImage = async () => {
    if (!activeImage || !onImageReplace) return;
    setIsRotating(true);
    try {
      const sourceFile = activeImage.originFileObj || await imageUrlToFile(activeImage, activeImage.name || 'image.png');
      const rotatedFile = await rotateImageFile(sourceFile);
      const replaced = await onImageReplace(activeImage.slotId, activeImage.uid, rotatedFile);
      if (replaced === false) return;
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } catch (err) {
      message.error(err.message || '图片旋转失败');
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <div className={`experiment-image-panel ${className}`.trim()}>
      <div className="experiment-image-head">
        <h3>{title}</h3>
        <div className="image-toolbar">
          <Button
            icon={<RotateRightOutlined />}
            style={{ background: '#fff' }}
            loading={isRotating}
            disabled={!activeImage || !onImageReplace}
            onClick={handleRotateImage}
          >
            旋转
          </Button>
          <Button icon={<ZoomInOutlined />} style={{ background: '#fff' }} onClick={() => setScale(s => Math.min(s + 0.15, 2.4))}>放大</Button>
          <Button icon={<ZoomOutOutlined />} style={{ background: '#fff' }} onClick={() => setScale(s => Math.max(s - 0.15, 0.7))}>缩小</Button>
          <Button icon={<ReloadOutlined />} style={{ background: '#fff' }} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>还原</Button>
        </div>
      </div>

      {activeImage ? (
        <div
          className="image-preview-stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          onDragOver={(event) => {
            if (onExternalImageDrop) event.preventDefault();
          }}
          onDrop={handleExternalDrop}
        >
          <img
            alt={activeImage.name}
            src={resolveImageUrl(activeImage.url)}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
            draggable={false}
          />
        </div>
      ) : (
        <Upload.Dragger
          accept="image/*"
          beforeUpload={(file) => onImageUpload(images[0]?.id || 'IMG_RAW', file)}
          multiple
          showUploadList={false}
          onDrop={handleExternalDrop}
        >
          <div className="image-upload-empty">
            <CloudUploadOutlined />
            <strong>{emptyTitle}</strong>
            <span>{emptyHint}</span>
          </div>
        </Upload.Dragger>
      )}

      {allImages.length > 0 && (
        <div className="image-gallery-strip" style={{ display: 'flex', gap: '12px', padding: '12px 16px', overflowX: 'auto', alignItems: 'center', background: '#fafafa', borderTop: '1px solid #f0f0f0', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' }}>
          {allImages.map((img, idx) => (
            <div
              key={img.uid}
              style={{
                position: 'relative', flexShrink: 0, cursor: 'pointer',
                border: activeIndex === idx ? '2px solid #1677ff' : '2px solid transparent',
                borderRadius: '6px', overflow: 'hidden', width: '64px', height: '64px',
                background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}
              onClick={() => {
                setActiveIndex(idx);
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              <img src={resolveImageUrl(img.url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="thumb" />
              <div
                style={{
                  position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.45)',
                  color: '#fff', width: '20px', height: '20px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', borderBottomLeftRadius: '4px',
                  fontSize: '12px'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveImage(img.slotId, img.uid);
                  if (activeIndex >= allImages.length - 1) setActiveIndex(Math.max(0, allImages.length - 2));
                }}
              >
                ✕
              </div>
            </div>
          ))}
          <Upload
            accept="image/*"
            beforeUpload={(file) => onImageUpload(images[0]?.id || 'IMG_RAW', file)}
            multiple
            showUploadList={false}
          >
            <div style={{
              width: '64px', height: '64px', border: '1px dashed #d9d9d9', borderRadius: '6px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              background: '#fff', color: '#8c8c8c', flexShrink: 0
            }}>
              <CloudUploadOutlined style={{ fontSize: '20px' }} />
            </div>
          </Upload>
        </div>
      )}

      <div className="image-action-row">
        {recognitionDef && (
          <Button
            className="recognize-primary-button"
            type="primary"
            icon={<RecognizeIcon />}
            loading={isRecognizing}
            onClick={onRecognize}
          >
            一键识别并填表 (Plus/Pro)
          </Button>
        )}
      </div>
    </div>
  );
}
