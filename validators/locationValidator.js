const { query } = require("express-validator");

function positiveIntegerAliasRule(primaryKey, aliasKey, fieldLabel) {
  return query(primaryKey).custom((value, { req }) => {
    const rawValue = value ?? req.query?.[aliasKey];

    if (rawValue === undefined || rawValue === null || rawValue === "") {
      throw new Error(`${fieldLabel} is required`);
    }

    const number = Number(rawValue);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`${fieldLabel} must be a positive integer`);
    }

    return true;
  });
}

exports.getDistrictsRules = [
  positiveIntegerAliasRule("provinceId", "province_id", "provinceId"),
];

exports.getWardsRules = [
  positiveIntegerAliasRule("districtId", "district_id", "districtId"),
];
