const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const ROOT_DIR = path.join(__dirname, "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const Store = require(path.join(ROOT_DIR, "models", "Store"));
const ghnService = require(path.join(ROOT_DIR, "services", "ghnService"));

const BASE_STORES = [
  {
    code: "WDP-HQ",
    name: "WDP Flagship Store",
    status: "active",
    type: "flagship",
    phone: "02873000123",
    email: "flagship@wdp.vn",
    addressLine1: "Toa S1001 Vinhome Grand Park",
    ward: "Long Thanh My",
    district: "Thu Duc City",
    city: "Ho Chi Minh City",
    openingHours: "09:00 - 22:00",
    note: "Main flagship store and default shipping origin",
    supportsTryOn: true,
    supportsPickup: true,
    isDefault: true,
    sortOrder: 0,
    ghn: {
      provinceId: 202,
      provinceName: "Ho Chi Minh",
      districtId: 3695,
      districtName: "Thanh Pho Thu Duc",
      wardCode: "90752",
      wardName: "Phuong Long Thanh My",
      address: "Toa S1001 Vinhome Grand Park",
    },
  },
  {
    code: "WDP-HCM-D1",
    name: "WDP Dong Khoi Branch",
    status: "active",
    type: "branch",
    phone: "02873011234",
    email: "dongkhoi@wdp.vn",
    addressLine1: "88 Dong Khoi, Ben Nghe Ward",
    ward: "Ben Nghe",
    district: "District 1",
    city: "Ho Chi Minh City",
    openingHours: "09:00 - 22:00",
    note: "City-center branch with walk-in try-on support",
    supportsTryOn: true,
    supportsPickup: true,
    isDefault: false,
    sortOrder: 10,
    ghn: {
      provinceId: 202,
      provinceName: "Ho Chi Minh",
      districtId: 1442,
      districtName: "Quan 1",
      wardCode: "20101",
      wardName: "Phuong Ben Nghe",
      address: "88 Dong Khoi, Ben Nghe Ward",
    },
  },
  {
    code: "WDP-HCM-TD",
    name: "WDP Thu Duc Branch",
    status: "active",
    type: "branch",
    phone: "02873022345",
    email: "thuduc@wdp.vn",
    addressLine1: "216 Vo Van Ngan, Binh Tho Ward",
    ward: "Binh Tho",
    district: "Thu Duc City",
    city: "Ho Chi Minh City",
    openingHours: "09:00 - 21:30",
    note: "Suburban branch focused on pickup and preorder handoff",
    supportsTryOn: true,
    supportsPickup: true,
    isDefault: false,
    sortOrder: 20,
    ghn: {
      provinceId: 202,
      provinceName: "Ho Chi Minh",
      districtId: 3695,
      districtName: "Thanh Pho Thu Duc",
      wardCode: "90745",
      wardName: "Phuong Binh Tho",
      address: "216 Vo Van Ngan, Binh Tho Ward",
    },
  },
  {
    code: "WDP-HN-LT",
    name: "WDP Hanoi Lotte Branch",
    status: "active",
    type: "branch",
    phone: "02473033456",
    email: "hanoi@wdp.vn",
    addressLine1: "54 Lieu Giai, Cong Vi Ward",
    ward: "Cong Vi",
    district: "Ba Dinh",
    city: "Ha Noi",
    openingHours: "09:30 - 22:00",
    note: "Northern flagship branch with full try-on demo area",
    supportsTryOn: true,
    supportsPickup: true,
    isDefault: false,
    sortOrder: 30,
    ghn: {
      provinceId: 201,
      provinceName: "Ha Noi",
      districtId: 1484,
      districtName: "Quan Ba Dinh",
      wardCode: "1A0101",
      wardName: "Phuong Cong Vi",
      address: "54 Lieu Giai, Cong Vi Ward",
    },
  },
  {
    code: "WDP-DN-HC",
    name: "WDP Da Nang Branch",
    status: "active",
    type: "branch",
    phone: "02367304567",
    email: "danang@wdp.vn",
    addressLine1: "120 Bach Dang, Hai Chau 1 Ward",
    ward: "Hai Chau 1",
    district: "Hai Chau",
    city: "Da Nang",
    openingHours: "09:00 - 21:30",
    note: "Central region branch for walk-in consultations and pickup",
    supportsTryOn: true,
    supportsPickup: true,
    isDefault: false,
    sortOrder: 40,
    ghn: {
      provinceId: 203,
      provinceName: "Da Nang",
      districtId: 1526,
      districtName: "Quan Hai Chau",
      wardCode: "40103",
      wardName: "Phuong Hai Chau I",
      address: "120 Bach Dang, Hai Chau 1 Ward",
    },
  },
  {
    code: "WDP-WH-SOUTH",
    name: "WDP South Warehouse",
    status: "active",
    type: "warehouse",
    phone: "02873044567",
    email: "warehouse.south@wdp.vn",
    addressLine1: "25 Street 12, Linh Trung Export Processing Zone",
    ward: "Linh Trung",
    district: "Thu Duc City",
    city: "Ho Chi Minh City",
    openingHours: "08:00 - 17:30",
    note: "Warehouse node for replenishment and inter-branch transfers",
    supportsTryOn: false,
    supportsPickup: false,
    isDefault: false,
    sortOrder: 50,
    ghn: {
      provinceId: 202,
      provinceName: "Ho Chi Minh",
      districtId: 3695,
      districtName: "Thanh Pho Thu Duc",
      wardCode: "90737",
      wardName: "Phuong Linh Trung",
      address: "25 Street 12, Linh Trung Export Processing Zone",
    },
  },
];

async function buildCanonicalStores() {
  const stores = BASE_STORES.map((store) => ({ ...store }));
  try {
    const payload = await ghnService.getStores({ limit: 50 });
    const rows = Array.isArray(payload?.data?.shops) ? payload.data.shops : [];
    const preferredShopId = Number(process.env.GHN_SHOP_ID || 0);
    const remote = rows.find((item) => Number(item?._id) === preferredShopId) || rows[0];
    if (!remote) {
      return stores;
    }

    const flagshipIndex = stores.findIndex((store) => store.code === "WDP-HQ");
    if (flagshipIndex >= 0) {
      stores[flagshipIndex] = {
        ...stores[flagshipIndex],
        phone: String(remote.phone || stores[flagshipIndex].phone || "").trim(),
        addressLine1: String(remote.address_v2 || remote.address || stores[flagshipIndex].addressLine1 || "").trim(),
        ghn: {
          shopId: Number(remote._id || 0) || null,
          clientId: Number(remote.client_id || 0) || null,
          districtId: Number(remote.district_id || 0) || null,
          wardCode: String(remote.ward_code || "").trim(),
          address: String(remote.address_v2 || remote.address || "").trim(),
          syncedAt: new Date(),
          lastSyncError: "",
        },
      };
    }
  } catch (error) {
    // Keep canonical local stores even if GHN is temporarily unavailable.
  }

  return stores;
}

function pickDefinedFields(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const STORES = await buildCanonicalStores();
    const summary = {
      created: 0,
      updated: 0,
      unchanged: 0,
      stores: [],
    };

    for (const payload of STORES) {
      const existing = await Store.findOne({ code: payload.code });
      if (!existing) {
        const created = await Store.create(payload);
        summary.created += 1;
        summary.stores.push({
          code: created.code,
          action: "created",
          id: String(created._id),
          name: created.name,
        });
        continue;
      }

      const nextValues = pickDefinedFields(payload);
      let changed = false;
      for (const [key, value] of Object.entries(nextValues)) {
        if (JSON.stringify(existing[key]) !== JSON.stringify(value)) {
          existing[key] = value;
          changed = true;
        }
      }

      if (changed) {
        await existing.save();
        summary.updated += 1;
        summary.stores.push({
          code: existing.code,
          action: "updated",
          id: String(existing._id),
          name: existing.name,
        });
      } else {
        summary.unchanged += 1;
        summary.stores.push({
          code: existing.code,
          action: "unchanged",
          id: String(existing._id),
          name: existing.name,
        });
      }
    }

    const totalStores = await Store.countDocuments();
    console.log(
      JSON.stringify(
        {
          status: "ok",
          totalStores,
          summary,
        },
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = {
  BASE_STORES,
  buildCanonicalStores,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: error?.message || "Unknown error",
          stack: error?.stack || "",
        },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
