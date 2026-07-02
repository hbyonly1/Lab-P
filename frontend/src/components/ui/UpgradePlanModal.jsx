import React, { useState } from 'react';
import { Modal, Button, Tag, Space, message } from 'antd';
import { CheckOutlined, CloseOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { createOrder } from '../../services/ordersApi.js';
import { PLAN_PRICES } from '../../constants/pricing.js';

export function UpgradePlanModal({ open, onClose, plans = [], currentPlan }) {
  const [showQR, setShowQR] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');

  // 每次打开弹窗重置状态
  React.useEffect(() => {
    if (open) {
      setShowQR(false);
      const defaultPlanObj = plans.find(p => p.key === currentPlan);
      setSelectedPlan(defaultPlanObj ? defaultPlanObj.name : '');
    }
  }, [open, currentPlan, plans]);

  const handleUpgradeClick = (planName) => {
    setSelectedPlan(planName);
    setShowQR(true);
  };

  const handleModalCancel = () => {
    if (showQR) {
      setShowQR(false);
    } else {
      onClose();
    }
  };

  const renderQRState = () => {
    const selectedPlanObj = plans.find(p => p.name === selectedPlan);
    const price = selectedPlanObj ? PLAN_PRICES[selectedPlanObj.key] : 0;

    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', maxWidth: '500px', margin: '0 auto', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
        <h3 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>扫码升级至 {selectedPlan}</h3>
        <div style={{ fontSize: '20px', color: '#1677ff', fontWeight: 500, marginBottom: '24px' }}>
          您需支付 ¥{price} 元
        </div>
        <div style={{ width: '200px', height: '200px', background: '#f0f2f5', margin: '0 auto 24px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #d9d9d9', borderRadius: '8px' }}>
          {/* 这里先用占位，之后可以替换为实际图片 src="/assets/wechat-pay.png" */}
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
            返回套餐选择
          </Button>
          <Button type="primary" onClick={async () => {
            try {
              await createOrder({ 
                experiment_id: "UPGRADE_PLAN", 
                plan: selectedPlan.toLowerCase() 
              });
              onClose();
              Modal.info({ 
                title: '订单已挂起', 
                content: '您的升级订单已提交并处于待付款挂起状态。请确保已扫码支付，管理员核实后，您的服务级别将自动更新。', 
                okText: '知道了',
                onOk: () => window.location.reload()
              });
            } catch(e) {
              message.error("创建订单失败：" + e.message);
            }
          }} size="large" style={{ background: '#1677ff' }}>
            我已支付，下一步
          </Button>
        </Space>
      </div>
    );
  };

  const renderCardsState = () => {
    // 价格与层级映射
    const planMeta = {
      free: { level: 0 },
      pay_per_use: { level: 0 },
      plus: { level: 1 },
      pro: { level: 2 }
    };
    const currentLevel = planMeta[currentPlan]?.level ?? 0;

    return (
      <div className="upgrade-plan-cards-container">
        {plans.map((plan) => {
          const isCurrent = plan.key === currentPlan;
          const isPro = plan.key === 'pro';
          const meta = planMeta[plan.key] || { level: 0 };
          const planPrice = PLAN_PRICES[plan.key] || 0;
          const isLowerLevel = meta.level < currentLevel;

          let btnText = `升级至 ${plan.name}`;
          let isDisabled = false;
          let isPrimary = false;

          if (isCurrent) {
            btnText = "你当前的套餐";
            isDisabled = true;
          } else if (plan.key === 'pay_per_use') {
            btnText = "一键提交时支付";
            isDisabled = true;
          } else if (isLowerLevel) {
            btnText = "无需升级";
            isDisabled = true;
          } else if (isPro) {
            isPrimary = true;
            btnText = "升级至 Pro";
          }

          return (
            <div key={plan.key} className={`upgrade-plan-card ${isPro ? 'is-pro' : ''}`}>
              <h3>
                {plan.name}
                {isPro && (
                  <Tag color="blue" style={{ margin: 0, borderRadius: '4px', border: 'none', background: '#e6f4ff', color: '#1677ff' }}>推荐</Tag>
                )}
              </h3>
              <div className="price">
                <span className="price-prefix">￥</span>{planPrice}<span>{plan.key === 'pay_per_use' ? '/次' : '/人'}</span>
              </div>
              <div className="desc">
                {plan.description}
              </div>

              <Button
                className="action-btn"
                type={isPrimary ? "primary" : "default"}
                style={isDisabled ? {} : (!isPrimary ? { border: '1px solid #d9d9d9', color: '#333' } : {})}
                disabled={isDisabled}
                onClick={() => !isDisabled && handleUpgradeClick(plan.name)}
              >
                {btnText}
              </Button>

              <ul className="feature-list">
                {plan.features.map((feature, idx) => {
                  let Icon = CheckOutlined;
                  let iconColor = '#52c41a';

                  if (feature.available === false) {
                    Icon = CloseOutlined;
                    iconColor = '#ff4d4f';
                  } else if (feature.warning === true) {
                    Icon = ExclamationCircleOutlined;
                    iconColor = '#faad14';
                  }

                  return (
                    <li key={idx} style={{ color: feature.available === false ? '#999' : '#333' }}>
                      <Icon style={{ color: iconColor }} /> {feature.text}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      title={showQR ? null : "升级套餐"}
      onCancel={handleModalCancel}
      footer={
        !showQR && (
          <div style={{ textAlign: 'center', marginTop: '16px', color: '#8c8c8c' }}>
            不想购买套餐？您可以在带有皇冠标识的一键提交操作时选择低至 ¥8/次的单次付费。
          </div>
        )
      }
      className="upgrade-fullscreen-modal"
      closable={true}
      destroyOnClose
    >
      {showQR ? renderQRState() : renderCardsState()}
    </Modal>
  );
}
