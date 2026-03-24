const REFUND_BANK_CATALOG = [
  {
    code: "VCB",
    name: "Vietcombank",
    aliases: [
      "ngan hang vietcombank",
      "vietcom bank",
      "ngan hang tmcp ngoai thuong viet nam",
    ],
  },
  {
    code: "BIDV",
    name: "BIDV",
    aliases: [
      "ngan hang bidv",
      "ngan hang dau tu va phat trien viet nam",
    ],
  },
  {
    code: "CTG",
    name: "VietinBank",
    aliases: [
      "vietin bank",
      "ngan hang vietinbank",
      "ngan hang tmcp cong thuong viet nam",
    ],
  },
  {
    code: "TCB",
    name: "Techcombank",
    aliases: ["techcom bank", "ngan hang techcombank"],
  },
  {
    code: "MBB",
    name: "MB Bank",
    aliases: ["mbbank", "ngan hang mb bank", "ngan hang quan doi"],
  },
  {
    code: "ACB",
    name: "ACB",
    aliases: ["asia commercial bank", "ngan hang acb"],
  },
  {
    code: "VPB",
    name: "VPBank",
    aliases: ["vp bank", "ngan hang vpbank"],
  },
  {
    code: "TPB",
    name: "TPBank",
    aliases: ["tp bank", "ngan hang tpbank"],
  },
  {
    code: "VIB",
    name: "VIB",
    aliases: ["ngan hang vib", "vietnam international bank"],
  },
  {
    code: "STB",
    name: "Sacombank",
    aliases: ["sacom bank", "ngan hang sacombank"],
  },
  {
    code: "HDB",
    name: "HDBank",
    aliases: ["hd bank", "ngan hang hdbank"],
  },
  {
    code: "OCB",
    name: "OCB",
    aliases: ["ngan hang ocb", "orient commercial bank"],
  },
  {
    code: "SHB",
    name: "SHB",
    aliases: ["ngan hang shb", "saigon hanoi bank"],
  },
  {
    code: "MSB",
    name: "MSB",
    aliases: ["ngan hang msb", "maritime bank"],
  },
  {
    code: "EIB",
    name: "Eximbank",
    aliases: ["exim bank", "ngan hang eximbank"],
  },
  {
    code: "LPB",
    name: "LPBank",
    aliases: ["lienvietpostbank", "ngan hang lpbank", "lp bank"],
  },
  {
    code: "SEAB",
    name: "SeABank",
    aliases: ["sea bank", "ngan hang seabank"],
  },
];

function normalizeLookupText(value = "") {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findRefundBank({ bankCode, bankName } = {}) {
  const normalizedCode = String(bankCode || "")
    .trim()
    .toUpperCase();
  if (normalizedCode) {
    const exact = REFUND_BANK_CATALOG.find((bank) => bank.code === normalizedCode);
    if (exact) return exact;
  }

  const normalizedName = normalizeLookupText(bankName);
  if (!normalizedName) return null;

  return (
    REFUND_BANK_CATALOG.find((bank) => {
      const aliases = [bank.name, ...(bank.aliases || [])].map(normalizeLookupText);
      return aliases.includes(normalizedName);
    }) || null
  );
}

function normalizeRefundAccountNumber(value = "") {
  return value.toString().replace(/[^\d]/g, "");
}

function isRefundAccountNumberFormatValid(value = "") {
  return /^\d{8,19}$/.test(normalizeRefundAccountNumber(value));
}

module.exports = {
  REFUND_BANK_CATALOG,
  findRefundBank,
  normalizeRefundAccountNumber,
  isRefundAccountNumberFormatValid,
};
