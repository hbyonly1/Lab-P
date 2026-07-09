import {
  MenuOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';

const landingNavItems = [
  { label: '概览', href: '#top' },
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="floating-nav" aria-label="CUMTB Lab+ navigation">
        <div className="logo-lockup" aria-label="CUMTB Lab+">
          <span className="logo-text">CUMTB Lab+</span>
        </div>

        <nav className="nav-links" aria-label="入口页分区">
          {landingNavItems.map((item) => (
            <a href={item.href} key={item.label}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="nav-actions">
          <a className="nav-admin-button" href="/login">
            进入工作台
          </a>
          <Button className="icon-button mobile-only" icon={<MenuOutlined />} aria-label="打开菜单" />
        </div>
      </header>

      <section className="hero-section hero-section-overview" id="top">
        <div className="hero-copy reveal-block">
          <p className="eyebrow">
            <span />
            LAB REPORT PLATFORM
          </p>
          <h1>CUMTB Lab+</h1>
          <p className="hero-lede">
            集 AI 提取手写数据、生成曲线图、数据计算等的一站式超级聚合工作台。
          </p>
          <div className="hero-actions">
            <a className="primary-pill" href="/login">
              进入工作台
              <RightOutlined />
            </a>
            <a className="secondary-pill" href="/login">
              登录账号
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
