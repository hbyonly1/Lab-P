import {
  BarChartOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  MenuOutlined,
  PlaySquareOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';

const landingNavItems = [
  { label: '概览', href: '#top' },
  { label: '产品价值', href: '#产品价值' },
  { label: '项目亮点', href: '#项目亮点' },
  { label: '核心闭环', href: '#核心闭环' },
  { label: '应用场景', href: '#应用场景' },
];

const pipelineSteps = [
  {
    title: '捕捉情绪火花',
    description: '识别反转、冲突、心动、爽点等剧情情绪峰值。',
  },
  {
    title: '提炼剧情爆点',
    description: '将字幕和时间轴片段转化为可运营的高光建议。',
  },
  {
    title: '审核互动内容',
    description: '在下发之前完成编辑、确认和发布。',
  },
  {
    title: '下发互动策略',
    description: '把触发时间和互动策略下发到客户端。',
  },
  {
    title: '触发即时回应',
    description: '让低门槛互动出现在用户情绪最强的瞬间。',
  },
  {
    title: '回流互动数据',
    description: '将曝光、点击和忽略行为沉淀为策略优化依据。',
  },
];

const highlightCards = [
  {
    id: 'content-understanding',
    title: '内容理解',
    eyebrow: 'UNDERSTAND',
    description: '从短剧字幕和剧情节奏中识别关键情绪节点，找到适合触发互动的高光时刻。',
    icon: <ExperimentOutlined />,
  },
  {
    id: 'strategy-orchestration',
    title: '策略编排',
    eyebrow: 'ORCHESTRATE',
    description: '将高光片段转化为可发布的互动按钮、触发时间和播放策略。',
    icon: <PlaySquareOutlined />,
  },
  {
    id: 'client-interaction',
    title: '端上互动',
    eyebrow: 'ENGAGE',
    description: '在观看不中断的前提下，以轻量互动承接用户情绪，让表达更即时、更低门槛。',
    icon: <FileTextOutlined />,
  },
  {
    id: 'data-feedback',
    title: '数据反馈',
    eyebrow: 'FEEDBACK',
    description: '追踪曝光、点击和忽略行为，帮助团队判断哪些时刻真正打动观众。',
    icon: <BarChartOutlined />,
  },
];

const audienceScenes = [
  {
    title: '提升用户体验',
    description: '在反转和冲突等情绪高峰触发互动，提升观看参与感。',
    type: 'player',
  },
  {
    title: '内容运营',
    description: '通过高光点与回应数据判断哪些剧情模式更容易成为爆点。',
    type: 'ops',
  },
  {
    title: '商业转化',
    description: '在用户情绪最强的时刻承接关注、预约、会员、商品或活动转化。',
    type: 'conversion',
  },
  {
    title: '数据分析',
    description: '把回应率、点击率和高光分布回流到后台，形成策略优化依据。',
    type: 'chart',
  },
];

function MiniScene({ type }) {
  if (type === 'player') {
    return (
      <div className="mini-ui mini-player">
        <div className="mini-video" />
        <div className="mini-timeline">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (type === 'ops') {
    return (
      <div className="mini-ui mini-ops">
        <div className="mini-ops-track">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (type === 'conversion') {
    return (
      <div className="mini-ui mini-conversion">
        <div className="mini-video" />
        <button>预约下一集</button>
        <button>开通会员</button>
        <button>购买商品</button>
      </div>
    );
  }

  return (
    <div className="mini-ui mini-chart">
      <span style={{ height: '42%' }} />
      <span style={{ height: '76%' }} />
      <span style={{ height: '58%' }} />
      <span style={{ height: '88%' }} />
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="floating-nav" aria-label="IgniteNow admin navigation">
        <div className="logo-lockup" aria-label="IgniteNow Admin">
          <span className="logo-text">IgniteNow</span>
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
          <Button
            shape="circle"
            className="icon-button mobile-only"
            icon={<MenuOutlined />}
            aria-label="打开菜单"
          />
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="hero-copy reveal-block">
          <p className="eyebrow">
            <span />
            INTERACTION ENGINE
          </p>
          <h1>点燃剧情高光</h1>
          <h1>让回应发生在此刻</h1>
          <p className="hero-lede">
            IgniteNow 识别短剧内容中的关键情绪节点，并将其转化为生动的互动体验
          </p>
          <div className="hero-actions">
            <a className="primary-pill" href="/login">
              进入工作台
              <RightOutlined />
            </a>
            <a className="secondary-pill" href="#项目亮点">
              了解项目亮点
            </a>
          </div>
        </div>

        <div className="hero-engine-panel reveal-block" aria-label="短剧互动引擎预览">
          <div className="engine-video">
            <div className="engine-video-top">
              <span>EP.04</span>
              <span>LIVE MOMENTS</span>
            </div>
            <div className="engine-caption">她终于发现真相</div>
          </div>
          <div className="engine-timeline">
            <div className="timeline-track" />
            {['反转', '冲突', '心动', '爽点'].map((node, index) => (
              <div className={`emotion-node emotion-node-${index + 1}`} key={node}>
                <span />
                <strong>{node}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="value-section reveal-block" id="产品价值">
        <p className="watermark">Value</p>
        <div className="value-copy">
          <p className="eyebrow">
            <span />
            PRODUCT VALUE
          </p>
          <p className="value-kicker">产品价值</p>
          <h2>把转瞬即逝的情绪</h2>
          <h2>变成互动时刻</h2>
          <p>
            短剧的高光瞬间很容易引起用户的共鸣，但传统评论和弹幕输入繁琐，大大降低了用户的互动欲望。
          </p>
          <p>
            IgniteNow 将剧情高光识别、互动策略和端上触发连接起来，让用户瞬间完成低门槛回应。
          </p>
        </div>
        <div className="before-after-panel">
          <article className="comparison-card before-card">
            <span>Before</span>
            <div className="comparison-screen">
              <div className="plain-video" />
              <div className="comment-entry">
                <span className="comment-placeholder">输入弹幕...</span>
                <span className="comment-typing">我感觉这段好恐怖</span>
              </div>
            </div>
            <p>传统的弹幕和评论，使得用户互动门槛较高。</p>
          </article>
          <article className="comparison-card after-card">
            <span>After</span>
            <div className="comparison-screen">
              <div className="plain-video active-video" />
              <div className="comparison-timeline">
                <i />
                <i />
                <i />
              </div>
              <div className="floating-actions">
                <button>爽到了</button>
                <button>有反转</button>
                <button>磕到了</button>
              </div>
            </div>
            <p>到达高光节点后，屏幕展现精彩的互动，回应发生在此时此刻。</p>
          </article>
        </div>
      </section>

      <section className="feature-section reveal-block" id="项目亮点">
        <div className="section-heading feature-heading">
          <p className="eyebrow">
            <span />
            HIGHLIGHTS
          </p>
          <h2>项目亮点</h2>
        </div>

        <div className="light-trail feature-trail" aria-hidden="true" />
        <div className="bento-grid">
          {highlightCards.map((feature) => (
            <article className="bento-card" id={feature.id} key={feature.title}>
              <div className="bento-icon">
                <span className="feature-icon">{feature.icon}</span>
              </div>
              <p className="feature-eyebrow">
                <span />
                {feature.eyebrow}
              </p>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pipeline-section reveal-block" id="核心闭环">
        <p className="watermark">Flow</p>
        <div className="section-heading">
          <p className="eyebrow">
            <span />
            CORE LOOP
          </p>
          <h2>核心闭环</h2>
        </div>
        <div className="loop-engine">
          <div className="loop-curve" />
          {pipelineSteps.map((step, index) => (
            <article className="loop-node" key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="audience-section reveal-block" id="应用场景">
        <div>
          <p className="eyebrow">
            <span />
            AUDIENCE SCENES
          </p>
          <h2>应用场景</h2>
        </div>
        <div className="audience-grid">
          {audienceScenes.map((scene) => (
            <article className="audience-card" key={scene.title}>
              <MiniScene type={scene.type} />
              <h3>{scene.title}</h3>
              <p>{scene.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
