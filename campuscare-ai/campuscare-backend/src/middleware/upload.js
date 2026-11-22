import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype] || '.jpg'}`),
});

/** Up to 3 photos, 5 MB each, field name "images". */
export const uploadImages = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) cb(null, true);
    else cb(Object.assign(new Error('Only JPG, PNG, WebP or GIF photos can be attached.'), { status: 400 }));
  },
}).array('images', 3);

/** Public URL path for a stored file (served by express.static at /api/uploads). */
export const publicPath = (file) => `/api/uploads/${path.basename(file.filename || file.path)}`;
