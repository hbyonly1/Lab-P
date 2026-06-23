import { Button } from 'antd';

export default function OutlineButton({ className = '', ...props }) {
  return <Button className={['ui-outline-button', className].filter(Boolean).join(' ')} {...props} />;
}
