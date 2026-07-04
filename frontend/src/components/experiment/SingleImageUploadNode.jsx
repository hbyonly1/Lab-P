import React from 'react';
import { ExperimentImageUploader } from './ExperimentImageUploader.jsx';
import { ReviewerNodeHint } from './ReviewerNodeHint.jsx';

export function SingleImageUploadNode({
  nodeId,
  imageSlot,
  imageSlots,
  onImageUpload,
  onRemoveImage,
  title,
  emptyTitle,
  emptyHint,
  showNodeInspector = false,
  nodeMeta,
  value,
}) {
  if (!imageSlot) return null;

  return (
    <div className="inline-image-node" data-node-id={nodeId}>
      <ExperimentImageUploader
        images={[imageSlot]}
        imageSlots={imageSlots}
        onImageUpload={onImageUpload}
        onRecognize={null}
        isRecognizing={false}
        canUseRecognition={false}
        recognitionDef={null}
        title={title || imageSlot.title || '上传图片'}
        emptyTitle={emptyTitle || '上传此处对应图片'}
        emptyHint={emptyHint || '支持多图片，可拖动上传或点击选择'}
        className="is-inline-image-node"
        onRemoveImage={onRemoveImage}
      />
      {showNodeInspector && (
        <span className="inline-image-node-hint">
          <ReviewerNodeHint nodeId={nodeId} meta={nodeMeta} value={value} />
        </span>
      )}
    </div>
  );
}
