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

router.get('/provinces', getProvinces);
router.get('/districts', getDistrictsRules, validate, getDistricts);
router.get('/wards', getWardsRules, validate, getWards);

module.exports = router;
