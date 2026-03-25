# Demo Walkthrough

This walkthrough assumes the backend is running locally and demo data has been prepared with:

```bash
npm run demo:clean
npm run demo:seed
npm run demo:verify
```

All demo accounts use the same password: `Demo123!`

## Demo Accounts

| Role | Email |
|------|-------|
| System Admin | `DEMO_admin@wdp.demo` |
| Manager | `DEMO_manager@wdp.demo` |
| Sales HCM | `DEMO_sales_hcm@wdp.demo` |
| Operations HCM | `DEMO_operations_hcm@wdp.demo` |
| Sales HN | `DEMO_sales_hn@wdp.demo` |
| Operations HN | `DEMO_operations_hn@wdp.demo` |
| Customer | `DEMO_customer@wdp.demo` |

## 1. Customer

Login:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_customer@wdp.demo\",\"password\":\"Demo123!\"}"
```

Use the returned token as `CUSTOMER_TOKEN`.

Customer checks current orders and support cases:

```bash
curl http://localhost:3000/api/orders/me \
  -H "Authorization: Bearer CUSTOMER_TOKEN"

curl http://localhost:3000/api/support \
  -H "Authorization: Bearer CUSTOMER_TOKEN"
```

Expected demo data:
- `DEMO_ORDER_READY_HCM`
- `DEMO_ORDER_PREORDER_HN_REFUND`
- `DEMO_ORDER_PRESCRIPTION_HCM`
- `DEMO_ORDER_WARRANTY_HCM`
- `DEMO_TICKET_REFUND_HN`
- `DEMO_TICKET_WARRANTY_HCM`
- `DEMO_TICKET_TRIAGE_GENERAL`

## 2. Sales / Support Staff

HCM sales:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_sales_hcm@wdp.demo\",\"password\":\"Demo123!\"}"
```

Use the returned token as `SALES_HCM_TOKEN`.

HCM sales should only see HCM business data:

```bash
curl "http://localhost:3000/api/orders?storeId=67f100000000000000000001" \
  -H "Authorization: Bearer SALES_HCM_TOKEN"

curl "http://localhost:3000/api/support/warranties" \
  -H "Authorization: Bearer SALES_HCM_TOKEN"
```

HN sales show pre-order and refund cases:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_sales_hn@wdp.demo\",\"password\":\"Demo123!\"}"

curl "http://localhost:3000/api/orders?storeId=67f100000000000000000002" \
  -H "Authorization: Bearer SALES_HN_TOKEN"

curl "http://localhost:3000/api/support/refunds" \
  -H "Authorization: Bearer SALES_HN_TOKEN"
```

Expected:
- `sales_hcm` does not see `DEMO_ORDER_PREORDER_HN_REFUND`
- `sales_hn` does not see `DEMO_ORDER_READY_HCM`
- neither sales account sees `DEMO_TICKET_TRIAGE_GENERAL`

## 3. Operations Staff

Operations HCM should see the HCM inventory intake:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_operations_hcm@wdp.demo\",\"password\":\"Demo123!\"}"

curl "http://localhost:3000/api/inventory/receipts?storeId=67f100000000000000000001" \
  -H "Authorization: Bearer OPS_HCM_TOKEN"
```

Operations HN should see the HN preorder batch:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_operations_hn@wdp.demo\",\"password\":\"Demo123!\"}"

curl "http://localhost:3000/api/preorders/batches?storeId=67f100000000000000000002" \
  -H "Authorization: Bearer OPS_HN_TOKEN"
```

Expected:
- `DEMO_STOCK_RECEIPT_HCM` only appears for HCM operations and manager
- `DEMO_BATCH_HN_PREORDER_001` only appears for HN staff and manager

## 4. Manager

Manager has chain-wide business visibility across the two demo stores:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_manager@wdp.demo\",\"password\":\"Demo123!\"}"
```

Use the returned token as `MANAGER_TOKEN`.

Manager walkthrough:

```bash
curl http://localhost:3000/api/support \
  -H "Authorization: Bearer MANAGER_TOKEN"

curl http://localhost:3000/api/preorders/batches \
  -H "Authorization: Bearer MANAGER_TOKEN"

curl http://localhost:3000/api/inventory/receipts \
  -H "Authorization: Bearer MANAGER_TOKEN"

curl http://localhost:3000/api/analytics/admin/refunds/overview \
  -H "Authorization: Bearer MANAGER_TOKEN"
```

Expected:
- sees both HCM and HN orders
- sees `DEMO_TICKET_TRIAGE_GENERAL`
- can inspect legacy refund analytics compatibility paths

## 5. System Admin

Admin is only for system-level checks, not business workflows:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"DEMO_admin@wdp.demo\",\"password\":\"Demo123!\"}"

curl http://localhost:3000/api/system-config \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

Expected:
- admin can access `/api/system-config`
- admin is blocked from support business flow such as `/api/support/warranties`
