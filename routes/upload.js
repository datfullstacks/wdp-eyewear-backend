const express = require('express');
const multer = require('multer');
const path = require('path');
const { supabase, supabaseBucket } = require('../services/supabaseClient');
const { protect, authorize } = require('../middlewares/auth');

const router = express.Router();
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'model/gltf-binary',
  'model/gltf+json',
  'model/vnd.usdz+zip'
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.glb', '.gltf', '.usdz']);
const MAX_UPLOAD_SIZE_MB = Number(process.env.UPLOAD_MAX_SIZE_MB || 25);
const MAX_UPLOAD_SIZE_BYTES = Number.isFinite(MAX_UPLOAD_SIZE_MB) && MAX_UPLOAD_SIZE_MB > 0
  ? Math.floor(MAX_UPLOAD_SIZE_MB * 1024 * 1024)
  : 25 * 1024 * 1024;

const isFileTypeAllowed = (file = {}) => {
  const mime = String(file.mimetype || '').trim().toLowerCase();
  const ext = path.extname(String(file.originalname || '')).trim().toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  if (ALLOWED_MIME_TYPES.has(mime)) return true;

  // Some clients upload 3D files with a generic MIME type.
  if (mime === 'application/octet-stream') {
    return ['.glb', '.gltf', '.usdz'].includes(ext);
  }

  return false;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isFileTypeAllowed(file)) {
      return cb(new Error('Unsupported file type. Allowed: jpg, png, webp, glb, gltf, usdz'));
    }
    return cb(null, true);
  }
});

const uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Max size is ${MAX_UPLOAD_SIZE_MB}MB`
      });
    }

    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid file upload'
    });
  });
};

const slugifySegment = (value = '') =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeFolderPath = (value = '') => {
  const segments = value
    .toString()
    .split(/[\\/]+/)
    .map((segment) => slugifySegment(segment))
    .filter(Boolean);

  return segments.length > 0 ? segments.join('/') : 'uploads';
};

/**
 * @swagger
 * /api/uploads:
 *   post:
 *     summary: Upload a file to Supabase Storage
 *     tags:
 *       - Uploads
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: File to upload (image/model/etc.)
 *               folder:
 *                 type: string
 *                 description: Optional folder/slug prefix
 *     responses:
 *       201:
 *         description: Uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     path:
 *                       type: string
 *                     url:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     size:
 *                       type: integer
 *       400:
 *         description: Missing file
 *       500:
 *         description: Upload failed or Supabase not configured
 */
router.post(
  '/',
  protect,
  authorize('admin', 'manager', 'operations'),
  uploadSingleFile,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({ success: false, message: 'Supabase is not configured.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'file is required (multipart/form-data)' });
      }

      const original = req.file.originalname || 'file';
      const folder = normalizeFolderPath(req.body.folder || '');
      const basename = slugifySegment(original.replace(/\.[^/.]+$/, '')) || 'file';
      const ext = original.split('.').pop();
      const filename = `${basename}-${Date.now()}.${ext}`;
      const storagePath = `${folder}/${filename}`;

      const { error } = await supabase.storage
        .from(supabaseBucket)
        .upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype,
          cacheControl: '31536000',
          upsert: false
        });

      if (error) {
        return res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
      }

      const { data } = supabase.storage.from(supabaseBucket).getPublicUrl(storagePath);

      return res.status(201).json({
        success: true,
        message: 'Uploaded successfully',
        data: {
          path: storagePath,
          url: data.publicUrl,
          contentType: req.file.mimetype,
          size: req.file.size
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  }
);

module.exports = router;
