import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Toaster
      position="top-right"
      toastOptions={{
        style: { background: '#1e2130', color: '#e2e8f0', border: '1px solid #2d3748' },
        duration: 4000,
      }}
    />
  </React.StrictMode>
);
