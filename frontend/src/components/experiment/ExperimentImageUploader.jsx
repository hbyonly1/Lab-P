import React, { useState } from 'react';
import { Button, Upload } from 'antd';
import {
  CloudUploadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ReloadOutlined,
  CameraOutlined
} from '@ant-design/icons';
import { apiClient } from '../../services/apiClient.js';

const resolveImageUrl = (url) => {
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

export function ExperimentImageUploader({ images, imageSlots, onImageUpload, onRecognize, isRecognizing, canUseRecognition, recognitionDef, onRemoveImage }) {
  const allImages = images?.flatMap(slot =>
    (imageSlots[slot.id] || []).map(file => ({ ...file, slotId: slot.id, slotLabel: slot.label }))
  ) || [];

  const [activeIndex, setActiveIndex] = useState(0);
  const activeImage = allImages[activeIndex] || allImages[0];

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

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

  return (
    <div className="experiment-image-panel">
      <div className="experiment-image-head">
        <h3>对应图片</h3>
        <div className="image-toolbar">
          <Button icon={<ZoomInOutlined />} style={{ background: '#fff' }} onClick={() => setScale(s => Math.min(s + 0.15, 2.4))}>放大</Button>
          <Button icon={<ZoomOutOutlined />} style={{ background: '#fff' }} onClick={() => setScale(s => Math.max(s - 0.15, 0.7))}>缩小</Button>
          <Button icon={<ReloadOutlined />} style={{ background: '#fff' }} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>重置位置</Button>
        </div>
      </div>

      {activeImage ? (
        <div
          className="image-preview-stage"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
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
        >
          <div className="image-upload-empty">
            <CloudUploadOutlined />
            <strong>拖动文件到这里上传实验图片</strong>
            <span>支持多张图片，可拖动或用鼠标滚轮缩放来对比信息</span>
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
