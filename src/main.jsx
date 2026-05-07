import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// pdf.js — set worker before any usage
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
window.pdfjsLib = pdfjsLib;

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
