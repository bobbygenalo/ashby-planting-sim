import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { restoreWorkspace } from './store/persistence';
import './ui/styles.css';

// Bring back the owner's saved work before the first screen. A shared-link visitor skips this.
restoreWorkspace();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
