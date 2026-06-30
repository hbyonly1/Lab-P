import React from 'react';
import { Drawer, List, Typography, Tag, Space } from 'antd';
import { CheckOutlined, NotificationOutlined, ToolOutlined, GiftOutlined } from '@ant-design/icons';
import OutlineButton from './OutlineButton';

const { Text, Paragraph } = Typography;

const TYPE_META = {
  update: { label: '系统更新', color: 'blue', icon: <ToolOutlined /> },
  notice: { label: '重要通知', color: 'volcano', icon: <NotificationOutlined /> },
  promotion: { label: '活动福利', color: 'gold', icon: <GiftOutlined /> },
};

export default function AnnouncementDrawer({
  visible,
  onClose,
  announcements = [],
  onMarkAsRead,
  onMarkAllRead,
}) {
  const unreadCount = announcements.filter((a) => !a.is_read).length;

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>系统公告</span>
          {unreadCount > 0 && (
            <OutlineButton 
              size="small" 
              icon={<CheckOutlined />} 
              onClick={onMarkAllRead}
              style={{ fontSize: 12, height: 26, minHeight: 26, padding: '0 8px' }}
            >
              全部标为已读
            </OutlineButton>
          )}
        </div>
      }
      placement="right"
      onClose={onClose}
      open={visible}
      width={400}
    >
      <List
        itemLayout="vertical"
        dataSource={announcements}
        locale={{ emptyText: '暂无公告' }}
        renderItem={(item) => {
          const meta = TYPE_META[item.type] || TYPE_META.notice;
          return (
            <List.Item
              key={item.id}
              style={{
                opacity: item.is_read ? 0.6 : 1,
                background: '#ffffff',
                padding: '16px',
                borderRadius: '8px',
                marginBottom: '12px',
                border: '1px solid',
                borderColor: item.is_read ? '#f0f0f0' : 'rgba(31, 119, 255, 0.15)',
                cursor: item.is_read ? 'default' : 'pointer',
                transition: 'all 0.3s',
                boxShadow: item.is_read ? 'none' : '0 2px 8px rgba(31, 119, 255, 0.04)'
              }}
              onClick={() => {
                if (!item.is_read) {
                  onMarkAsRead(item.id);
                }
              }}
            >
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center' }}>
                {!item.is_read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4d4f', display: 'inline-block', marginRight: 8 }} />}
                <Tag color={meta.color} icon={meta.icon} style={{ margin: 0 }}>{meta.label}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong style={{ fontSize: 15, color: '#202535' }}>{item.title}</Text>
                <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>{item.created_at}</Text>
              </div>
              <Paragraph 
                style={{ marginBottom: 0, color: '#596276', fontSize: 13, lineHeight: '1.6' }}
              >
                {item.content}
              </Paragraph>
            </List.Item>
          );
        }}
      />
    </Drawer>
  );
}
