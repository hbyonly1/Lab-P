import { useRef, useState } from 'react';
import { Table, message } from 'antd';
import { EyeOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { OutlineButton, PageHeading, TablePanel } from '../../components/ui/index.js';
import {
  loadExperimentProfiles,
  normalizeExperimentProfiles,
  saveExperimentProfiles,
} from './experimentConfigStore.js';

export default function ExperimentConfigPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [profiles, setProfiles] = useState(() => loadExperimentProfiles());

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      const nextProfiles = normalizeExperimentProfiles(payload);
      setProfiles(nextProfiles);
      saveExperimentProfiles(nextProfiles);
      message.success(`已导入 ${nextProfiles.length} 个实验配置。`);
    } catch (error) {
      message.error(error?.message || 'JSON 解析失败，请检查文件格式。');
    }
  };

  const columns = [
    {
      title: '实验名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, record) => (
        <OutlineButton
          icon={<EyeOutlined />}
          onClick={() => navigate(`/workspace/admin/experiments/${record.id}/preview`)}
        >
          预览
        </OutlineButton>
      ),
    },
  ];

  return (
    <section className="workspace-standard-page admin-experiments-page">
      <PageHeading
        title="实验配置"
        description="通过 JSON 管理实验识别、填空和自动化配置"
        actions={
          <>
            <OutlineButton icon={<UploadOutlined />} onClick={handleUploadClick}>
              上传 JSON
            </OutlineButton>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={handleFileChange}
            />
          </>
        }
      />

      <TablePanel>
        <Table
          columns={columns}
          dataSource={profiles}
          locale={{ emptyText: '暂无实验配置' }}
          pagination={false}
          rowKey="id"
        />
      </TablePanel>
    </section>
  );
}
