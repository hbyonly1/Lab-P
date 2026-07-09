import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const MIN_IMAGE_SCALE = 0.5;
const MAX_IMAGE_SCALE = 6;
const IMAGE_SCALE_STEP = 0.5;

export const resolveImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/uploads/')) {
    return '';
  }
  if (url.startsWith('/')) {
    return `${apiClient.defaults.baseURL || window.location.origin}${url}`;
  }
  return url;
};

const isPrivateUploadUrl = (url) => typeof url === 'string' && url.startsWith('/uploads/');

export const fetchPrivateImageBlob = async (url) => {
  const response = await apiClient.get('/api/v1/files/view', {
    params: { path: url },
    responseType: 'blob',
  });
  return response.data;
};

export const useAuthenticatedImageUrl = (url) => {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    let active = true;
    let createdUrl = '';

    if (!isPrivateUploadUrl(url)) {
      setObjectUrl(resolveImageUrl(url));
      return () => {};
    }

    setObjectUrl('');
    fetchPrivateImageBlob(url)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (active) setObjectUrl('');
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url]);

  return objectUrl;
};

export function AuthenticatedImage({ src, alt, ...props }) {
  const resolvedSrc = useAuthenticatedImageUrl(src);
  return <img src={resolvedSrc} alt={alt} {...props} />;
}

const resolvePlaceholderImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('/assets/') || /^https?:\/\//i.test(url)) return url;
  return resolveImageUrl(url);
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
  let blob;
  if (isPrivateUploadUrl(image.url)) {
    blob = await fetchPrivateImageBlob(image.url);
  } else {
    const response = await fetch(resolveImageUrl(image.url));
    if (!response.ok) throw new Error('图片读取失败');
    blob = await response.blob();
  }
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
  placeholderImage = null,
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
  const [hoveredSlotId, setHoveredSlotId] = useState(null);
  const previousImageUidsRef = useRef([]);

  useEffect(() => {
    const currentUids = allImages.map((image) => image.uid || image.url).filter(Boolean);
    const previousUids = previousImageUidsRef.current;
    const addedUid = currentUids.find((uid) => !previousUids.includes(uid));
    previousImageUidsRef.current = currentUids;
    if (!addedUid || previousUids.length === 0) return;
    const addedIndex = allImages.findIndex((image) => (image.uid || image.url) === addedUid);
    if (addedIndex >= 0) {
      setActiveIndex(addedIndex);
    }
  }, [allImages]);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [activeImage?.uid]);

  const updateScale = (delta) => {
    setScale((current) => {
      const nextScale = current + delta;
      return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, Number(nextScale.toFixed(2))));
    });
  };

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

  const handleWheel = (event) => {
    if (!activeImage) return;
    event.preventDefault();
    updateScale(event.deltaY < 0 ? IMAGE_SCALE_STEP : -IMAGE_SCALE_STEP);
  };

  const getDefaultSlotId = () => images?.[0]?.id || 'IMG_RAW';
  const getPasteSlotId = () => hoveredSlotId || activeImage?.slotId || getDefaultSlotId();

  const uploadClipboardImages = useCallback(async (event) => {
    if (!onImageUpload) return;
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type?.startsWith('image/'))
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) return null;
        const extension = file.type?.split('/')[1] || 'png';
        return new File([file], file.name || `clipboard-image-${Date.now()}-${index + 1}.${extension}`, {
          type: file.type || 'image/png',
        });
      })
      .filter(Boolean);

    if (!files.length) return;
    const slotId = getPasteSlotId();
    event.preventDefault();
    event.stopPropagation();
    message.loading({ content: `正在粘贴上传 ${files.length} 张图片...`, key: 'clipboard-image-upload' });
    try {
      for (const file of files) {
        await onImageUpload(slotId, file);
      }
      message.success({ content: `已粘贴上传 ${files.length} 张图片`, key: 'clipboard-image-upload' });
    } catch (error) {
      message.error({ content: error.message || '粘贴上传失败', key: 'clipboard-image-upload' });
    }
  }, [activeImage?.slotId, hoveredSlotId, images, onImageUpload]);

  useEffect(() => {
    if (!hoveredSlotId) return undefined;
    const handleDocumentPaste = (event) => {
      uploadClipboardImages(event);
    };
    document.addEventListener('paste', handleDocumentPaste);
    return () => {
      document.removeEventListener('paste', handleDocumentPaste);
    };
  }, [hoveredSlotId, uploadClipboardImages]);

  const uploadDroppedFiles = async (event) => {
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => (
      file.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name || '')
    ));
    if (!files.length || !onImageUpload) return false;

    event.preventDefault();
    event.stopPropagation();
    for (const file of files) {
      await onImageUpload(getDefaultSlotId(), file);
    }
    return true;
  };

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

  const handlePreviewDragOver = (event) => {
    const hasFiles = Array.from(event.dataTransfer?.types || []).includes('Files');
    if (hasFiles || onExternalImageDrop) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const handlePreviewDrop = async (event) => {
    if (await uploadDroppedFiles(event)) return;
    await handleExternalDrop(event);
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
    <div
      className={`experiment-image-panel ${className}`.trim()}
      onMouseEnter={() => setHoveredSlotId(getDefaultSlotId())}
      onMouseLeave={() => setHoveredSlotId(null)}
    >
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
          <Button icon={<ZoomInOutlined />} style={{ background: '#fff' }} onClick={() => updateScale(IMAGE_SCALE_STEP)}>放大</Button>
          <Button icon={<ZoomOutOutlined />} style={{ background: '#fff' }} onClick={() => updateScale(-IMAGE_SCALE_STEP)}>缩小</Button>
          <Button icon={<ReloadOutlined />} style={{ background: '#fff' }} onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>还原</Button>
        </div>
      </div>

      {activeImage ? (
        <div
          className="image-preview-stage"
          onMouseEnter={() => setHoveredSlotId(activeImage.slotId || getDefaultSlotId())}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDragging}
          onMouseLeave={stopDragging}
          onWheel={handleWheel}
          onDragOver={handlePreviewDragOver}
          onDrop={handlePreviewDrop}
        >
          <AuthenticatedImage
            alt={activeImage.name}
            src={activeImage.url}
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
          onMouseEnter={() => setHoveredSlotId(getDefaultSlotId())}
        >
          <div className="image-upload-empty">
            {placeholderImage && (
              <img
                className="image-upload-placeholder-image"
                src={resolvePlaceholderImageUrl(placeholderImage)}
                alt=""
                aria-hidden="true"
              />
            )}
            <CloudUploadOutlined />
            <strong>{emptyTitle}</strong>
            <span>{emptyHint}</span>
          </div>
        </Upload.Dragger>
      )}

      {allImages.length > 0 && (
        <div className="image-gallery-strip">
          {allImages.map((img, idx) => (
            <div
              key={img.uid}
              className={`image-gallery-thumb ${activeIndex === idx ? 'is-active' : ''}`}
              onClick={() => {
                setActiveIndex(idx);
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              <AuthenticatedImage src={img.url} alt="thumb" />
              <div
                className="image-gallery-remove"
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
            <div className="image-gallery-upload" onMouseEnter={() => setHoveredSlotId(getDefaultSlotId())}>
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
            一键识别并填表
          </Button>
        )}
      </div>
    </div>
  );
}
