import { Table } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { OutlineButton, PageHeading, TablePanel } from '../../components/ui/index.js';
import { getAllExperiments } from '../../services/experimentConfigStore.js';

export default function ExperimentConfigPage() {
  const navigate = useNavigate();
  // 从全局 V2 Store 加载实验
  const profiles = getAllExperiments();

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
        description="管理实验配置。暂不支持配置导入。"
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
