import type { Plugin } from 'vite';
import { shareMiddleware } from './shareMiddleware';
import { fileShareStore } from './shareStore';

/** Serves the share API during `vite` and `vite preview`, storing snapshots as files under `dir`. */
export function sharePlugin(dir = '.share-data'): Plugin {
  const handler = shareMiddleware(fileShareStore(dir));
  return {
    name: 'ashby-share-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
