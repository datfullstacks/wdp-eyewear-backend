const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/response');
const locationService = require('../services/locationService');

exports.getProvinces = asyncHandler(async (req, res) => {
  const provinces = await locationService.getProvinces();
  ApiResponse.success(res, provinces, 'Locations retrieved successfully');
});

exports.getDistricts = asyncHandler(async (req, res) => {
  const provinceId = req.query.provinceId ?? req.query.province_id;
  const districts = await locationService.getDistricts(provinceId);
  ApiResponse.success(res, districts, 'Locations retrieved successfully');
});

exports.getWards = asyncHandler(async (req, res) => {
  const districtId = req.query.districtId ?? req.query.district_id;
  const wards = await locationService.getWards(districtId);
  ApiResponse.success(res, wards, 'Locations retrieved successfully');
});
