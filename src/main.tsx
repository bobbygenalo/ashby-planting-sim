import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { PlantLab } from './scene/PlantLab';
import { restoreWorkspace } from './store/persistence';
import './ui/styles.css';

// Bring back the owner's saved work before the first screen. A shared-link visitor skips this.
// ?lab opens a development-only page that lines plants up at several ages to check their shapes.
const lab = import.meta.env.DEV && new URLSearchParams(window.location.search).has('lab');
if (!lab) restoreWorkspace();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? <PlantLab /> : <App />}
  </StrictMode>,
);
