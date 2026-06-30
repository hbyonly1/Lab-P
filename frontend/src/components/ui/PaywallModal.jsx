import React, { useState } from 'react';
import { Modal, Button, Tag, Space, Typography, Alert } from 'antd';
import { CrownOutlined, PayCircleOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export function PaywallModal({ open, onCancel, taskCount = 1 }) {
  const [showQR, setShowQR] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');

  const singlePrice = 8;
  const totalPrice = taskCount * singlePrice;
  const proPrice = 50;

  const isUpsell = totalPrice >= 32; // 如果金额接近或超过 Pro，强力推荐

  // 重置状态
  React.useEffect(() => {
    if (open) {
      setShowQR(false);
      setSelectedPlan('');
    }
  }, [open]);

  const handleSelect = (planName) => {
    setSelectedPlan(planName);
    setShowQR(true);
  };

  const handleModalCancel = (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    if (showQR) {
      setShowQR(false);
    } else {
      onCancel(false);
    }
  };

  const renderQRState = () => (
    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
      <h3 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>扫码支付 - {selectedPlan}</h3>
      <div style={{ fontSize: '20px', color: '#1677ff', fontWeight: 500, marginBottom: '24px' }}>
        您需支付 ¥{selectedPlan.includes('单次') ? totalPrice : proPrice} 元
      </div>
      <div style={{ width: '200px', height: '200px', background: '#f0f2f5', margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d9d9d9', borderRadius: '8px' }}>
        <span style={{ color: '#8c8c8c' }}>微信收款码占位图</span>
      </div>
      <p style={{ fontSize: '16px', color: '#1a1a1a', fontWeight: 500, marginBottom: '12px' }}>
        请备注您的学号
      </p>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '32px' }}>
        我们将马上处理您的订单，若有疑问请联系 QQ:1952096193
      </p>
      <Space>
        <Button onClick={() => setShowQR(false)} size="large">
          返回选择
        </Button>
        <Button type="primary" onClick={(e) => {
          if (e?.stopPropagation) e.stopPropagation();
          onCancel(true);
        }} size="large" style={{ background: '#1677ff' }}>
          我已支付，下一步
        </Button>
      </Space>
    </div>
  );

  const renderCardsState = () => (
    <div style={{ padding: '16px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <CrownOutlined style={{ fontSize: '48px', color: '#faad14', marginBottom: '16px' }} />
        <h2 style={{ margin: 0, fontSize: '20px' }}>该功能为高级特性</h2>
        <p style={{ color: '#666', marginTop: '8px' }}>
          您正在尝试完整提交 {taskCount} 个实验任务。这需要 Pro 权限或单次付费解锁。
        </p>
      </div>

      {isUpsell && (
        <Alert
          message="强烈建议开通 Pro 套餐！"
          description={`您本次按次付费需要花费 ¥${totalPrice}，而开通一整个月的 Pro 畅享套餐仅需 ¥${proPrice}！立马回本且本月不限次数！`}
          type="warning"
          showIcon
          style={{ marginBottom: '24px', border: '1px solid #ffe58f' }}
        />
      )}

      <div style={{ display: 'flex', gap: '16px', flexDirection: 'column' }}>
        <div style={{
          border: isUpsell ? '1px solid #d9d9d9' : '2px solid #1677ff',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isUpsell ? '#fafafa' : '#e6f4ff'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px' }}>单次解锁 (共 {taskCount} 个任务)</h3>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>仅针对本次选择的实验进行人工代劳。</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1677ff' }}>¥ {totalPrice}</div>
            <Button onClick={() => handleSelect('单次购买')} type={isUpsell ? 'default' : 'primary'} style={{ marginTop: '8px' }}>
              ¥{totalPrice} 购买单次
            </Button>
          </div>
        </div>

        <div style={{
          border: isUpsell ? '2px solid #faad14' : '1px solid #d9d9d9',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isUpsell ? '#fffbe6' : '#fff'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px' }}>
              升级 Pro 套餐
              {isUpsell && <Tag color="orange" style={{ marginLeft: '8px' }}>超值推荐</Tag>}
            </h3>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>尊享本学号无限次一键提交、自动填报及所有高阶 AI 特性。</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#faad14' }}>¥ {proPrice}</div>
            <Button onClick={() => handleSelect('Pro 包月套餐')} type={isUpsell ? 'primary' : 'default'} style={isUpsell ? { background: '#faad14', borderColor: '#faad14' } : { marginTop: '8px' }}>
              ¥{proPrice} 立即升级
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={handleModalCancel}
      footer={null}
      width={600}
      destroyOnClose
    >
      {showQR ? renderQRState() : renderCardsState()}
    </Modal>
  );
}
