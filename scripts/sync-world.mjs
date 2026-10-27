import { cp, mkdir, rm } from 'node:fs/promises';
const target = new URL('../web/public/world/', import.meta.url);
await mkdir(new URL('../web/public/', import.meta.url), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(new URL('../dist/', import.meta.url), target, { recursive: true });
