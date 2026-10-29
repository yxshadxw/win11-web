// Disk images for the PC emulator app. Only freely redistributable systems are listed; each
// is fetched once from its upstream mirror and then served from this origin's cache, so the
// browser has no CORS trouble and the mirror is not hammered.
import { serveCached } from './mirror.mjs';

const MIRROR = (process.env.PC_IMAGE_BASE || 'https://i.copy.sh/').replace(/\/?$/, '/');

/** id → upstream file and its exact size (v86 needs the size up front). */
export const IMAGES = {
  freedos: { file: 'freedos722.img', size: 737280 },
  kolibri: { file: 'kolibri.img', size: 1474560 },
  linux: { file: 'linux4.iso', size: 7731200 },
};

export function handlePcImage(req, res, pathname) {
  const id = pathname.slice('/api/pc/image/'.length);
  if (!Object.hasOwn(IMAGES, id) || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('unknown image');
  }
  const { file, size } = IMAGES[id];
  return serveCached(req, res, MIRROR + file, file, { size });
}
