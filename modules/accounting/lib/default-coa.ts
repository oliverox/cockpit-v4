/**
 * Default Chart of Accounts loaded on demand for a customer.
 * Adapted from the universal CFO COA template (Mauritius MRA-aware).
 *
 * Ported verbatim from cockpit-v3. Duplicate codes (50110/50120/50130) in the
 * source CSV — which split each material purchase into "Import" and "Local"
 * rows sharing one code — are merged into single rows here, leaving the
 * customer to add the split back if they need separate tracking.
 *
 * Plain data, no React: safe to import from Convex (the importDefaultCoa
 * mutation seeds from this).
 */

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export type DefaultCoaAccount = {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
};

const ACCOUNTS: DefaultCoaAccount[] = [
  // ── Assets ─────────────────────────────────────────────────────
  { code: "10000", name: "Cash & Bank", type: "asset" },
  { code: "10010", name: "Bank - Operating", type: "asset", parentCode: "10000" },
  { code: "10020", name: "Bank - Payroll", type: "asset", parentCode: "10000" },
  { code: "10030", name: "Bank - USD", type: "asset", parentCode: "10000" },
  { code: "10040", name: "Bank - EUR", type: "asset", parentCode: "10000" },
  { code: "10800", name: "Undeposited Funds", type: "asset", parentCode: "10000" },
  { code: "10810", name: "Petty Cash", type: "asset", parentCode: "10000" },

  { code: "10900", name: "Short-Term Investments", type: "asset" },
  { code: "10910", name: "Treasury Bills", type: "asset", parentCode: "10900" },
  { code: "10920", name: "Money Market Funds", type: "asset", parentCode: "10900" },
  { code: "10930", name: "Short-Term Deposits", type: "asset", parentCode: "10900" },

  { code: "11000", name: "Trade Receivables", type: "asset" },
  { code: "11010", name: "Trade Receivables - Local", type: "asset", parentCode: "11000" },
  { code: "11020", name: "Trade Receivables - Export", type: "asset", parentCode: "11000" },
  { code: "11030", name: "Allowance for Doubtful Debts", type: "asset", parentCode: "11000" },
  { code: "11040", name: "Employee Advances", type: "asset", parentCode: "11000" },
  { code: "11050", name: "Other Receivables", type: "asset", parentCode: "11000" },
  { code: "11060", name: "VAT Receivable", type: "asset", parentCode: "11000" },

  { code: "12000", name: "Prepayments", type: "asset" },
  { code: "12010", name: "Prepaid Insurance", type: "asset", parentCode: "12000" },
  { code: "12020", name: "Prepaid Rent", type: "asset", parentCode: "12000" },
  { code: "12030", name: "Prepaid Licenses", type: "asset", parentCode: "12000" },

  { code: "13000", name: "Inventory", type: "asset" },
  { code: "13010", name: "Raw Materials", type: "asset", parentCode: "13000" },
  { code: "13020", name: "Work In Progress", type: "asset", parentCode: "13000" },
  { code: "13030", name: "Finished Goods", type: "asset", parentCode: "13000" },
  { code: "13040", name: "Packaging", type: "asset", parentCode: "13000" },
  { code: "13050", name: "Goods In Transit", type: "asset", parentCode: "13000" },

  { code: "14000", name: "Other Current Assets", type: "asset" },
  { code: "14010", name: "Security Deposits", type: "asset", parentCode: "14000" },
  { code: "14020", name: "Tax Credits", type: "asset", parentCode: "14000" },

  { code: "15000", name: "Property, Plant & Equipment", type: "asset" },
  { code: "15010", name: "Land", type: "asset", parentCode: "15000" },
  { code: "15020", name: "Buildings", type: "asset", parentCode: "15000" },
  { code: "15030", name: "Machinery", type: "asset", parentCode: "15000" },
  { code: "15040", name: "Vehicles", type: "asset", parentCode: "15000" },
  { code: "15050", name: "Office Equipment", type: "asset", parentCode: "15000" },
  { code: "15060", name: "IT Equipment", type: "asset", parentCode: "15000" },
  { code: "15070", name: "Solar Installation", type: "asset", parentCode: "15000" },
  { code: "15100", name: "Construction In Progress", type: "asset", parentCode: "15000" },
  { code: "15900", name: "Accumulated Depreciation", type: "asset", parentCode: "15000" },

  { code: "16000", name: "Intangible Assets", type: "asset" },
  { code: "16010", name: "Software", type: "asset", parentCode: "16000" },
  { code: "16020", name: "Licenses", type: "asset", parentCode: "16000" },
  { code: "16030", name: "Trademarks", type: "asset", parentCode: "16000" },
  { code: "16040", name: "Goodwill", type: "asset", parentCode: "16000" },
  { code: "16900", name: "Accumulated Amortization", type: "asset", parentCode: "16000" },

  { code: "17000", name: "Investments", type: "asset" },
  { code: "17010", name: "Subsidiaries", type: "asset", parentCode: "17000" },
  { code: "17020", name: "Associates", type: "asset", parentCode: "17000" },
  { code: "17030", name: "Financial Investments", type: "asset", parentCode: "17000" },

  { code: "18000", name: "Other Non-Current Assets", type: "asset" },
  { code: "18010", name: "Deferred Tax Asset", type: "asset", parentCode: "18000" },
  { code: "18020", name: "Long Term Deposits", type: "asset", parentCode: "18000" },

  // ── Liabilities ────────────────────────────────────────────────
  { code: "20000", name: "Trade Payables", type: "liability" },
  { code: "20010", name: "Trade Payables - Local", type: "liability", parentCode: "20000" },
  { code: "20020", name: "Trade Payables - Foreign", type: "liability", parentCode: "20000" },

  { code: "21000", name: "Other Payables & Accruals", type: "liability" },
  { code: "21010", name: "Accrued Salaries", type: "liability", parentCode: "21000" },
  { code: "21020", name: "Accrued Expenses", type: "liability", parentCode: "21000" },
  { code: "21030", name: "VAT Payable", type: "liability", parentCode: "21000" },
  { code: "21040", name: "Excise Payable", type: "liability", parentCode: "21000" },
  { code: "21050", name: "PAYE Payable", type: "liability", parentCode: "21000" },
  { code: "21060", name: "Social Security Payable", type: "liability", parentCode: "21000" },
  { code: "21070", name: "Customer Deposits", type: "liability", parentCode: "21000" },
  { code: "21080", name: "Deferred Revenue", type: "liability", parentCode: "21000" },

  { code: "25000", name: "Long Term Liabilities", type: "liability" },
  { code: "25010", name: "Bank Loans", type: "liability", parentCode: "25000" },
  { code: "25020", name: "Lease Liabilities", type: "liability", parentCode: "25000" },
  { code: "25030", name: "Shareholder Loans", type: "liability", parentCode: "25000" },

  // ── Equity ─────────────────────────────────────────────────────
  { code: "30000", name: "Equity", type: "equity" },
  { code: "30010", name: "Share Capital", type: "equity", parentCode: "30000" },
  { code: "30020", name: "Additional Paid In Capital", type: "equity", parentCode: "30000" },
  { code: "30030", name: "Retained Earnings", type: "equity", parentCode: "30000" },

  // ── Revenue ────────────────────────────────────────────────────
  { code: "40000", name: "Revenue", type: "revenue" },
  { code: "40100", name: "Product Revenue", type: "revenue", parentCode: "40000" },
  { code: "40110", name: "Product Sales - Local", type: "revenue", parentCode: "40100" },
  { code: "40120", name: "Product Sales - Export", type: "revenue", parentCode: "40100" },
  { code: "40130", name: "Product Sales - Wholesale", type: "revenue", parentCode: "40100" },
  { code: "40140", name: "Product Sales - Retail", type: "revenue", parentCode: "40100" },
  { code: "40150", name: "Product Sales - Online", type: "revenue", parentCode: "40100" },

  { code: "40200", name: "Service Revenue", type: "revenue", parentCode: "40000" },
  { code: "40210", name: "Service Income", type: "revenue", parentCode: "40200" },
  { code: "40220", name: "Consulting Income", type: "revenue", parentCode: "40200" },
  { code: "40230", name: "Maintenance Contracts", type: "revenue", parentCode: "40200" },

  { code: "40300", name: "SaaS Revenue", type: "revenue", parentCode: "40000" },
  { code: "40310", name: "Subscription Revenue", type: "revenue", parentCode: "40300" },
  { code: "40320", name: "Platform Fees", type: "revenue", parentCode: "40300" },
  { code: "40330", name: "Advertising Revenue", type: "revenue", parentCode: "40300" },
  { code: "40340", name: "Commission Income", type: "revenue", parentCode: "40300" },

  { code: "40400", name: "Other Operating Revenue", type: "revenue", parentCode: "40000" },
  { code: "40410", name: "Rental Income - Residential", type: "revenue", parentCode: "40400" },
  { code: "40411", name: "Rental Income - Corporate", type: "revenue", parentCode: "40400" },
  { code: "40420", name: "Rebates Received", type: "revenue", parentCode: "40400" },
  { code: "40430", name: "Scrap Sales", type: "revenue", parentCode: "40400" },
  { code: "40440", name: "Government Grants", type: "revenue", parentCode: "40400" },

  // ── Cost of Sales ──────────────────────────────────────────────
  { code: "50000", name: "Cost of Sales", type: "expense" },
  { code: "50100", name: "Cost of Goods Sold", type: "expense", parentCode: "50000" },
  { code: "50110", name: "Purchase of Raw Materials", type: "expense", parentCode: "50100" },
  { code: "50120", name: "Purchase of Packaging Materials", type: "expense", parentCode: "50100" },
  { code: "50130", name: "Purchase of Finished Goods", type: "expense", parentCode: "50100" },

  { code: "50200", name: "Direct Labour", type: "expense", parentCode: "50000" },
  { code: "50210", name: "Production Labour", type: "expense", parentCode: "50200" },
  { code: "50220", name: "Overtime - Production", type: "expense", parentCode: "50200" },
  { code: "50230", name: "Contract Labour", type: "expense", parentCode: "50200" },

  { code: "50300", name: "Manufacturing Overheads", type: "expense", parentCode: "50000" },
  { code: "50310", name: "Factory Utilities", type: "expense", parentCode: "50300" },
  { code: "50320", name: "Factory Rent", type: "expense", parentCode: "50300" },
  { code: "50330", name: "Repairs & Maintenance - Factory", type: "expense", parentCode: "50300" },
  { code: "50340", name: "Depreciation - Production Assets", type: "expense", parentCode: "50300" },
  { code: "50350", name: "Consumables", type: "expense", parentCode: "50300" },

  { code: "50400", name: "Logistics & Import Costs", type: "expense", parentCode: "50000" },
  { code: "50410", name: "Freight In", type: "expense", parentCode: "50400" },
  { code: "50420", name: "Import Duties", type: "expense", parentCode: "50400" },
  { code: "50430", name: "Clearing Charges", type: "expense", parentCode: "50400" },
  { code: "50440", name: "Insurance - Freight", type: "expense", parentCode: "50400" },

  { code: "50500", name: "Inventory Adjustments", type: "expense", parentCode: "50000" },
  { code: "50510", name: "Inventory Write-Off", type: "expense", parentCode: "50500" },
  { code: "50520", name: "Inventory Shrinkage", type: "expense", parentCode: "50500" },
  { code: "50530", name: "Obsolescence Provision", type: "expense", parentCode: "50500" },

  // ── Operating Expenses ─────────────────────────────────────────
  { code: "60000", name: "Operating Expenses", type: "expense" },

  { code: "60100", name: "Payroll & Staff Costs", type: "expense", parentCode: "60000" },
  { code: "60110", name: "Salaries - Admin", type: "expense", parentCode: "60100" },
  { code: "60120", name: "Salaries - Finance", type: "expense", parentCode: "60100" },
  { code: "60130", name: "Salaries - Sales", type: "expense", parentCode: "60100" },
  { code: "60140", name: "Salaries - Marketing", type: "expense", parentCode: "60100" },
  { code: "60150", name: "Salaries - Logistics", type: "expense", parentCode: "60100" },
  { code: "60160", name: "Salaries - IT", type: "expense", parentCode: "60100" },
  { code: "60170", name: "Salaries - Management", type: "expense", parentCode: "60100" },
  { code: "60180", name: "Bonuses", type: "expense", parentCode: "60100" },
  { code: "60190", name: "Overtime", type: "expense", parentCode: "60100" },

  { code: "60200", name: "Pension Contributions", type: "expense", parentCode: "60100" },
  { code: "60210", name: "Social Security Contributions", type: "expense", parentCode: "60200" },
  { code: "60220", name: "Staff Welfare", type: "expense", parentCode: "60200" },
  { code: "60230", name: "Training & Development", type: "expense", parentCode: "60200" },

  { code: "61000", name: "General & Administrative", type: "expense", parentCode: "60000" },
  { code: "61010", name: "Rent - Office", type: "expense", parentCode: "61000" },
  { code: "61020", name: "Utilities - Office", type: "expense", parentCode: "61000" },
  { code: "61021", name: "Water", type: "expense", parentCode: "61020" },
  { code: "61022", name: "Electricity", type: "expense", parentCode: "61020" },
  { code: "61023", name: "Telephones & Internet", type: "expense", parentCode: "61020" },
  { code: "61030", name: "Cleaning & Security", type: "expense", parentCode: "61000" },
  { code: "61040", name: "Office Supplies", type: "expense", parentCode: "61000" },
  { code: "61050", name: "Printing & Stationery", type: "expense", parentCode: "61000" },
  { code: "61060", name: "Bank Fees", type: "expense", parentCode: "61000" },
  { code: "61070", name: "Meals & Entertainment", type: "expense", parentCode: "61000" },

  { code: "62000", name: "Professional & Compliance", type: "expense", parentCode: "60000" },
  { code: "62010", name: "Audit Fees", type: "expense", parentCode: "62000" },
  { code: "62020", name: "Legal Fees", type: "expense", parentCode: "62000" },
  { code: "62030", name: "Accounting Fees", type: "expense", parentCode: "62000" },
  { code: "62040", name: "Consulting Fees", type: "expense", parentCode: "62000" },

  { code: "63000", name: "Sales & Marketing", type: "expense", parentCode: "60000" },
  { code: "63010", name: "Advertising - Digital", type: "expense", parentCode: "63000" },
  { code: "63020", name: "Advertising - Traditional", type: "expense", parentCode: "63000" },
  { code: "63030", name: "Promotions & Discounts", type: "expense", parentCode: "63000" },
  { code: "63040", name: "Trade Marketing", type: "expense", parentCode: "63000" },
  { code: "63050", name: "Sponsorships", type: "expense", parentCode: "63000" },
  { code: "63060", name: "Sales Commissions", type: "expense", parentCode: "63000" },

  { code: "64000", name: "Distribution & Logistics", type: "expense", parentCode: "60000" },
  { code: "64010", name: "Delivery Expenses", type: "expense", parentCode: "64000" },
  { code: "64020", name: "Fuel", type: "expense", parentCode: "64000" },
  { code: "64030", name: "Vehicle Maintenance", type: "expense", parentCode: "64000" },
  { code: "64040", name: "Warehouse Costs", type: "expense", parentCode: "64000" },
  { code: "64050", name: "3PL Costs", type: "expense", parentCode: "64000" },

  { code: "65000", name: "IT & Systems", type: "expense", parentCode: "60000" },
  { code: "65010", name: "Software Subscriptions", type: "expense", parentCode: "65000" },
  { code: "65020", name: "Cloud Hosting", type: "expense", parentCode: "65000" },
  { code: "65030", name: "IT Support", type: "expense", parentCode: "65000" },
  { code: "65040", name: "Cybersecurity", type: "expense", parentCode: "65000" },

  { code: "66000", name: "Repairs & Maintenance", type: "expense", parentCode: "60000" },
  { code: "66010", name: "Equipment Maintenance", type: "expense", parentCode: "66000" },
  { code: "66020", name: "Building Maintenance", type: "expense", parentCode: "66000" },

  { code: "67000", name: "Insurance", type: "expense", parentCode: "60000" },
  { code: "67010", name: "General Insurance", type: "expense", parentCode: "67000" },
  { code: "67020", name: "Vehicle Insurance", type: "expense", parentCode: "67000" },
  { code: "67030", name: "Asset Insurance", type: "expense", parentCode: "67000" },

  { code: "68000", name: "Travel & Entertainment", type: "expense", parentCode: "60000" },
  { code: "68010", name: "Travel Expenses", type: "expense", parentCode: "68000" },
  { code: "68020", name: "Accommodation", type: "expense", parentCode: "68000" },
  { code: "68030", name: "Client Entertainment", type: "expense", parentCode: "68000" },

  { code: "69000", name: "Depreciation & Amortization", type: "expense", parentCode: "60000" },
  { code: "69010", name: "Depreciation - Office Assets", type: "expense", parentCode: "69000" },
  { code: "69020", name: "Depreciation - Vehicles", type: "expense", parentCode: "69000" },
  { code: "69030", name: "Amortization - Software", type: "expense", parentCode: "69000" },

  // ── Other Income / Expense / Tax ───────────────────────────────
  { code: "70000", name: "Other Income", type: "revenue" },
  { code: "70010", name: "Interest Income", type: "revenue", parentCode: "70000" },
  { code: "70020", name: "FX Gain - Realised", type: "revenue", parentCode: "70000" },
  { code: "70030", name: "FX Gain - Unrealised", type: "revenue", parentCode: "70000" },
  { code: "70040", name: "Gain on Disposal", type: "revenue", parentCode: "70000" },
  { code: "70050", name: "Dividend Income", type: "revenue", parentCode: "70000" },

  { code: "80000", name: "Other Expenses", type: "expense" },
  { code: "80010", name: "Interest Expense", type: "expense", parentCode: "80000" },
  { code: "80020", name: "FX Loss - Realised", type: "expense", parentCode: "80000" },
  { code: "80030", name: "FX Loss - Unrealised", type: "expense", parentCode: "80000" },
  { code: "80040", name: "Loss on Disposal", type: "expense", parentCode: "80000" },
  { code: "80050", name: "Penalties & Fines", type: "expense", parentCode: "80000" },

  { code: "90000", name: "Income Tax Expenses", type: "expense" },
  { code: "90100", name: "Current Income Tax", type: "expense", parentCode: "90000" },
  { code: "90200", name: "Deferred Tax Expenses", type: "expense", parentCode: "90000" },
  { code: "90300", name: "CSR Expense", type: "expense", parentCode: "90000" },
  { code: "90310", name: "CSR Contributions Paid", type: "expense", parentCode: "90300" },
  { code: "90400", name: "Other Taxes", type: "expense", parentCode: "90000" },

  { code: "91000", name: "Other Comprehensive Income / Loss", type: "equity" },
];

export const DEFAULT_COA: ReadonlyArray<DefaultCoaAccount> = ACCOUNTS;
