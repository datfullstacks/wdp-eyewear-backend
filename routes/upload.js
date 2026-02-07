const express = require('express');
const multer = require('multer');
const { supabase, supabaseBucket } = require('../services/supabaseClient');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
router.post('/', upload.single('file'), async (req, res) => {
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
});

module.exports = router;
