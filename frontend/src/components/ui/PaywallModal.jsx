import React, { useState } from 'react';
import { Modal, Button, Tag, Space, Typography, Alert } from 'antd';
import { CrownOutlined, PayCircleOutlined } from '@ant-design/icons';
import { quoteCheckout } from '../../services/checkoutApi.js';

const { Text, Paragraph } = Typography;

export function PaywallModal({ open, onCancel, taskCount = 1, experiments = [] }) {
  const [showQR, setShowQR] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [quotes, setQuotes] = useState({});
  const [quoteError, setQuoteError] = useState('');

  // 重置状态
  React.useEffect(() => {
    if (open) {
      setShowQR(false);
      setSelectedPlan('');
      setQuoteError('');
      Promise.all([
        quoteCheckout({ plan: 'pay_per_use', experiments }),
        quoteCheckout({ plan: 'pro', experiments }),
      ]).then(([payPerUse, pro]) => {
        setQuotes({ pay_per_use: payPerUse, pro });
      }).catch((error) => {
        setQuotes({});
        setQuoteError(error.response?.data?.detail || error.message || '报价失败');
      });
    }
  }, [open, experiments]);

  const payPerUseAmount = Number(quotes.pay_per_use?.total_amount || 0);
  const proAmount = Number(quotes.pro?.total_amount || 0);
  const isUpsell = payPerUseAmount > 0 && proAmount > 0 && payPerUseAmount >= proAmount * 0.64;
  const formatAmount = (amount) => Number(amount || 0).toFixed(2);
  const selectedQuote = quotes[selectedPlan];
  const selectedLabel = selectedPlan === 'pro' ? 'Pro 包月套餐' : '单次购买';

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
    <div style={{ textAlign: 'center', padding: '10px 10px' }}>
      <h3 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>扫码支付 - {selectedLabel}</h3>
      <div style={{ fontSize: '20px', color: '#1677ff', fontWeight: 500, marginBottom: '24px' }}>
        您需支付 ¥{formatAmount(selectedQuote?.total_amount)} 元
      </div>
      <div style={{ width: '220px', height: '220px', background: '#fff', margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d9d9d9', borderRadius: '8px', padding: '10px' }}>
        <img
          src="/assets/payment/pay.jpg"
          alt="收款码"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
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
          onCancel(true, selectedPlan);
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

      {quoteError && (
        <Alert
          message="获取报价失败"
          description={quoteError}
          type="error"
          showIcon
          style={{ marginBottom: '24px' }}
        />
      )}

      {isUpsell && (
        <Alert
          message="强烈建议开通 Pro 套餐！"
          description={`您本次按实验计价需要支付 ¥${formatAmount(payPerUseAmount)}，开通 Pro 套餐为 ¥${formatAmount(proAmount)}。`}
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
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1677ff' }}>¥ {formatAmount(payPerUseAmount)}</div>
            <Button disabled={!quotes.pay_per_use} onClick={() => handleSelect('pay_per_use')} type={isUpsell ? 'default' : 'primary'} style={{ marginTop: '8px' }}>
              ¥{formatAmount(payPerUseAmount)} 购买本次
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
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#faad14' }}>¥ {formatAmount(proAmount)}</div>
            <Button disabled={!quotes.pro} onClick={() => handleSelect('pro')} type={isUpsell ? 'primary' : 'default'} style={isUpsell ? { background: '#faad14', borderColor: '#faad14' } : { marginTop: '8px' }}>
              ¥{formatAmount(proAmount)} 立即升级
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      className="paywall-modal"
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
