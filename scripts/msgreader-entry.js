// Browser bundle entry for @kenjiuno/msgreader (Apache-2.0). Rebuild with: npm run build:vendor
import { Buffer } from 'buffer';
import mod from '@kenjiuno/msgreader';

globalThis.Buffer = globalThis.Buffer || Buffer;
export const MsgReader = mod.default || mod;
