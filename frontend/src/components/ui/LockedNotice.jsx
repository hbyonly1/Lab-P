import { CrownOutlined } from '@ant-design/icons';

export default function LockedNotice({
  description = '升级后可使用此模块，具体权限以后端校验结果为准。',
  title = 'Plus/Pro 解锁',
}) {
  return (
    <div className="ui-locked-notice">
      <CrownOutlined />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
