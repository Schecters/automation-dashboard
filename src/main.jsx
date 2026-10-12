import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css'
import { installAuthInterceptor } from './authInterceptor';

// ต้องติดตั้งก่อน render เพื่อให้ทุก fetch ถูกดัก 401 แล้ว auto logout
installAuthInterceptor();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);