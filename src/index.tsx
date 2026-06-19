import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// @ts-ignore
import './index.css';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import OAuth2Callback from './OAuth2Callback';

console.log("🔥 React index.tsx loaded");

const root = ReactDOM.createRoot(document.getElementById('root')!);

const isElectron =
  !!(window as any).electronAPI ||
  navigator.userAgent.toLowerCase().includes(" electron/");

const Router = isElectron ? HashRouter : BrowserRouter;

root.render(
    <React.StrictMode>
        <Router>
            <Routes>
                <Route path="/oauth2callback" element={<OAuth2Callback />} />
                <Route path="/*" element={<App />} />
            </Routes>
        </Router>
    </React.StrictMode>
);