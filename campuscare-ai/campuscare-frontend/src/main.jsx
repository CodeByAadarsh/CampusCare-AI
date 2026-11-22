import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { RealtimeProvider } from './realtime/RealtimeContext.jsx';
import { ROUTER_MODE } from './config.js';
import './styles/global.css';

const Router = ROUTER_MODE === 'hash' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <RealtimeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </RealtimeProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
