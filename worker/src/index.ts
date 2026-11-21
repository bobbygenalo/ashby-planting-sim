import { handle, type Env } from './api';

// The entry module may export only the handler; everything else lives in api.ts so tests can import it.
export default { fetch: (req: Request, env: Env) => handle(req, env) };
