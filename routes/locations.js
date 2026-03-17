const express = require('express');
const router = express.Router();
const {
  getProvinces,
  getDistricts,
  getWards
} = require('../controllers/locationController');
const { validate } = require('../middlewares/validator');
const {
  getDistrictsRules,
  getWardsRules
} = require('../validators/locationValidator');

/**
 * @swagger
 * tags:
 *   - name: Locations
 *     description: GHN-backed province, district, and ward lookup endpoints
 * components:
 *   schemas:
 *     Province:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         canUpdateCod:
 *           type: boolean
 *         status:
 *           type: string
 *           nullable: true
 *     District:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         provinceId:
 *           type: integer
 *         name:
 *           type: string
 *         code:
 *           type: string
 *         type:
 *           type: string
 *         supportType:
 *           type: integer
 *         canUpdateCod:
 *           type: boolean
 *         status:
 *           type: string
 *           nullable: true
 *     Ward:
 *       type: object
 *       properties:
 *         code:
 *           type: string
 *         districtId:
 *           type: integer
 *         name:
 *           type: string
 *         supportType:
 *           type: integer
 *         canUpdateCod:
 *           type: boolean
 *         status:
 *           type: string
 *           nullable: true
 * /api/locations/provinces:
 *   get:
 *     summary: List provinces
 *     tags: [Locations]
 *     responses:
 *       200:
 *         description: Provinces retrieved successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Province'
 * /api/locations/districts:
 *   get:
 *     summary: List districts by province id
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: provinceId
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Primary query key. `province_id` is also accepted.
 *       - in: query
 *         name: province_id
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Alias for `provinceId`.
 *     responses:
 *       200:
 *         description: Districts retrieved successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/District'
 *       400:
 *         description: Missing or invalid province id
 * /api/locations/wards:
 *   get:
 *     summary: List wards by district id
 *     tags: [Locations]
 *     parameters:
 *       - in: query
 *         name: districtId
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Primary query key. `district_id` is also accepted.
 *       - in: query
 *         name: district_id
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Alias for `districtId`.
 *     responses:
 *       200:
 *         description: Wards retrieved successfully
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Ward'
 *       400:
 *         description: Missing or invalid district id
 */

router.get('/provinces', getProvinces);
router.get('/districts', getDistrictsRules, validate, getDistricts);
router.get('/wards', getWardsRules, validate, getWards);

module.exports = router;
