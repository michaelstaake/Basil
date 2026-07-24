import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/google-sans/latin-400.css';
import '@fontsource/google-sans/latin-400-italic.css';
import '@fontsource/google-sans/latin-700.css';
import '@fontsource/google-sans/latin-700-italic.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-400-italic.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-700-italic.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-400-italic.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-700-italic.css';
import '@fontsource/ubuntu/latin-400.css';
import '@fontsource/ubuntu/latin-400-italic.css';
import '@fontsource/ubuntu/latin-700.css';
import '@fontsource/ubuntu/latin-700-italic.css';
import './lib/monaco';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
