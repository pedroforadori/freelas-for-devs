import './instrument.js';
import { ENV } from './shared/config/config.module.js';
import type { Env } from './shared/config/env.js';
import { createHttpApp } from './http-app.js';

const app = await createHttpApp();
const env = app.get<Env>(ENV);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
