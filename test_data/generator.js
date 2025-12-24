const fs = require('fs')
const path = require('path')

const roles = ['standard', 'premium', 'gold', 'admin']
const data = []

for (let i = 1; i <= 2000; i++) {
  const userId = `user-${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`
  const role = roles[Math.floor(Math.random() * roles.length)]

  const count = Math.floor(Math.random() * 10)
  const productNumber = Math.floor(Math.random() * 10) + 1
  const amount = productNumber * 100 * count
  const product = `product-${productNumber}`

  data.push({ userId, role, amount, product, count })
}

const filePath = path.join(__dirname, 'payments_data.json')
if (fs.existsSync(filePath)) {
  fs.unlinkSync(filePath)
}
fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
console.log('Generated 2000 test cases in payments_data.json')
