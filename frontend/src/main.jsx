import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/base.css';
import './styles/theme.css';
import './styles/ui.css';
import './styles/landing.css';
import './styles/workspace.css';
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        token: {
          colorPrimary: '#141413',
          colorText: '#141413',
          colorBgContainer: '#ffffff',
          borderRadius: 8,
          controlHeight: 32,
          fontFamily:
            '"Sofia Sans", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
