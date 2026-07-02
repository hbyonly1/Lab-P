import { useEffect, useState } from 'react';
import { Modal, Table, message } from 'antd';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { OutlineButton, PageHeading, StatusBadge, TablePanel } from '../../../components/ui/index.js';
import { experimentsApi } from '../../../services/experimentsApi.js';

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function ExperimentConfigPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadExperiments = () => {
    setLoading(true);
    return experimentsApi.listExperiments()
      .then(setProfiles)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadExperiments();
  }, []);

  const handleRefreshConfigs = () => {
    Modal.confirm({
      title: '刷新实验配置',
      content: '将重新扫描 backend/configs 下的本地 JSON 文件。只有文件内容发生变化时才会更新配置更新时间。',
      okText: '确认刷新',
      cancelText: '取消',
      onOk: async () => {
        try {
          setRefreshing(true);
          const result = await experimentsApi.refreshExperimentConfigs();
          message.success(`已扫描 ${result.scanned} 个配置，更新 ${result.changed + result.created} 个，跳过 ${result.unchanged} 个`);
          if (result.failed?.length) {
            message.warning(`有 ${result.failed.length} 个配置刷新失败，请查看后端日志`);
          }
          await loadExperiments();
        } catch (e) {
          message.error(e.response?.data?.detail || '刷新配置失败');
        } finally {
          setRefreshing(false);
        }
      },
    });
  };

  const columns = [
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 96,
      align: 'center',
      render: (value) => value ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 120,
      render: (enabled) => (
        <StatusBadge tone={enabled ? 'completed' : 'pending'}>
          {enabled ? '启用' : '停用'}
        </StatusBadge>
      ),
    },
    {
      title: '实验名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '配置更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 210,
      render: formatDateTime,
    },
    {
      title: '文件修改时间',
      dataIndex: 'config_file_mtime',
      key: 'config_file_mtime',
      width: 210,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, record) => (
        <OutlineButton
          icon={<EditOutlined />}
          onClick={() => navigate(`/workspace/admin/experiments/${record.id}/preview`)}
        >
          编辑
        </OutlineButton>
      ),
    },
  ];

  return (
    <section className="workspace-standard-page admin-experiments-page">
      <PageHeading
        title="实验配置"
        description="管理实验配置。"
        actions={(
          <OutlineButton icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefreshConfigs}>
            刷新配置
          </OutlineButton>
        )}
      />

      <TablePanel>
        <Table
          columns={columns}
          dataSource={profiles}
          loading={loading}
          locale={{ emptyText: '暂无实验配置' }}
          pagination={false}
          rowKey="id"
        />
      </TablePanel>
    </section>
  );
}
