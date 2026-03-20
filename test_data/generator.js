const fs = require("fs");
const path = require("path");

const roles = ["standard", "premium", "gold", "admin"];

/**
 * Phase 5.1.2.8 dataset goals
 * - Deterministic balance check failures (amount/count invalid)
 * - Enough volume for probabilistic gateway outcomes:
 *   - slow gateway success (~5%)
 *   - gateway errors (~5.1% by current PaymentStatusVO distribution)
 *
 * Keep the dataset small enough for quick iteration, but large enough
 * to reliably contain gateway failures for `failedAt="paymentGateway"`.
 */
const TOTAL = parseInt(process.env.TOTAL || "500", 10);
const INSUFFICIENT_BALANCE_CASES = parseInt(
  process.env.INSUFFICIENT_BALANCE_CASES || "40",
  10,
);

const data = [];

// A stable userId that some debug scripts expect.
data.push({
  userId: "fallback-test-user",
  role: "standard",
  product: "product-1",
  count: 0,
  amount: 100,
});

for (let i = 0; i < TOTAL; i++) {
  const userId = `user-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;
  const role = roles[Math.floor(Math.random() * roles.length)];

  const productNumber = Math.floor(Math.random() * 10) + 1;
  const product = `product-${productNumber}`;

  // Force some deterministic failures at Step 1 (balance check)
  if (i < INSUFFICIENT_BALANCE_CASES) {
    const count = i % 2 === 0 ? 0 : 1;
    const amount = i % 2 === 0 ? 100 : 0;
    data.push({ userId, role, product, count, amount });
    continue;
  }

  // Normal traffic for probabilistic gateway outcomes
  const count = Math.floor(Math.random() * 5) + 1; // 1..5
  const amount = productNumber * 100 * count;
  data.push({ userId, role, product, count, amount });
}

const filePath = path.join(__dirname, "payments_data.json");
if (fs.existsSync(filePath)) {
  fs.unlinkSync(filePath);
}
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log(
  `Generated ${data.length} test cases in payments_data.json (TOTAL=${TOTAL}, INSUFFICIENT_BALANCE_CASES=${INSUFFICIENT_BALANCE_CASES})`,
);
