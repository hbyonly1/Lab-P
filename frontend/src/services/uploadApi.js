import { apiClient } from './apiClient.js';

function replaceImageExtension(filename) {
  const base = String(filename || 'image').replace(/\.[^.]+$/, '');
  return `${base || 'image'}.jpg`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('浏览器无法解码该图片'));
    };
    image.src = url;
  });
}

async function transcodeFileToJpeg(file) {
  const image = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('图片转码失败'));
    }, 'image/jpeg', 0.92);
  });

  return new File([blob], replaceImageExtension(file.name), { type: 'image/jpeg' });
}

async function postUpload(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post('/api/v1/files/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  });
  return response.data;
}

export const uploadFile = async (file) => {
  try {
    return await postUpload(file);
  } catch (error) {
    if (error.response?.status === 415 && typeof document !== 'undefined') {
      try {
        return await postUpload(await transcodeFileToJpeg(file));
      } catch (transcodeError) {
        throw new Error(transcodeError.response?.data?.detail || transcodeError.message || error.response?.data?.detail || '文件上传失败');
      }
    }
    throw new Error(error.response?.data?.detail || '文件上传失败');
  }
};
