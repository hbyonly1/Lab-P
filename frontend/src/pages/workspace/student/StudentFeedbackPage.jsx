import React, { useState } from 'react';
import { Input, Button, Form, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { PageHeading, UiPanel } from '../../../components/ui/index.js';
import { submitFeedback } from '../../../services/feedbackApi.js';

const { TextArea } = Input;

export default function FeedbackPage() {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      await submitFeedback({
        contact_info: values.contact_info || null,
        description: values.description,
      });
      setDone(true);
      form.resetFields();
      message.success('反馈提交成功！感谢您的反馈！');
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      message.error(`提交失败：${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="workspace-standard-page student-feedback-page">
      <PageHeading
        title="反馈"
        description="遇到问题？有任何建议？欢迎告诉我们。"
      />

      {/* 复用 UiPanel 作为表单容器 */}
      <UiPanel>
        {done ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--lf-color-text-secondary)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <p style={{ fontSize: 16, marginBottom: 8 }}>反馈已成功提交！</p>
            <p style={{ marginBottom: 20 }}>我们将尽快处理，感谢您的反馈。</p>
            <Button onClick={() => setDone(false)}>返回</Button>
          </div>
        ) : (
          <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
            {/* 联系方式（可选） */}
            <Form.Item
              name="contact_info"
              label={
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--lf-color-text)' }}>
                  联系方式<span style={{ fontWeight: 400, color: 'var(--lf-color-text-secondary)' }}>（可选）</span>
                </span>
              }
            >
              <Input
                placeholder="QQ号 / 微信号 / 手机号 / 邮箱"
                size="large"
              />
            </Form.Item>

            {/* 问题描述 */}
            <Form.Item
              name="description"
              label={
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--lf-color-text)' }}>
                  问题描述
                </span>
              }
              rules={[{ required: true, message: '请填写问题描述' }]}
            >
              <TextArea
                rows={6}
                placeholder="请描述您遇到的问题或建议……"
                style={{ resize: 'vertical' }}
                maxLength={2000}
                showCount
              />
            </Form.Item>

            {/* 帮助文字 */}
            <p
              style={{
                fontSize: 14,
                color: 'var(--lf-color-text-secondary)',
                marginTop: -8,
                marginBottom: 20,
                lineHeight: 1.7,
              }}
            >
              请简要描述您的问题，可留下您的联系方式以便我们与您沟通，我们将会以最快的速度处理您的反馈
            </p>

            {/* 提交按钮，右对齐 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
              >
                提交
              </Button>
            </div>
          </Form>
        )}
      </UiPanel>
    </section>
  );
}
