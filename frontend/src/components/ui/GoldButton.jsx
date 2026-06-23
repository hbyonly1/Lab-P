import { Button } from 'antd';

export default function GoldButton({ className = '', ...props }) {
  return <Button className={['ui-gold-button', className].filter(Boolean).join(' ')} {...props} />;
}
