#!/bin/bash

# Configuration
DATA_FILE="$(dirname "$0")/payments_data.json"
URL="http://localhost:3000/payments"
CONCURRENCY=5 # Number of parallel requests to speed things up

if [ ! -f "$DATA_FILE" ]; then
    echo "Error: $DATA_FILE not found. Please run generator.js first."
    exit 1
fi

echo "===================================================="
echo "  Wide Event Logging Load Test"
echo "  Target: $URL"
echo "  Data:   $DATA_FILE (2000 entries)"
echo "===================================================="

# Check if backend is reachable
curl -s -I "$URL" > /dev/null
if [ $? -ne 0 ]; then
    echo "Warning: Cannot reach $URL. Make sure the backend is running."
fi

# We use Node.js to perform the actual requests efficiently
# This avoids the overhead of spawning 2000 curl processes sequentially
node -e "
const http = require('http');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$DATA_FILE', 'utf8'));

async function sendRequest(item, index) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(item);
    const req = http.request('$URL', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });

    req.on('error', (e) => {
      console.error('Request ' + (index + 1) + ' failed: ' + e.message);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

async function run() {
  const batchSize = $CONCURRENCY;
  let successCount = 0;
  
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((item, j) => sendRequest(item, i + j)));
    successCount += results.filter(Boolean).length;

    await new Promise((resolve) => setTimeout(resolve, 100));
    
    if ((i + batchSize) % 100 === 0 || i + batchSize >= data.length) {
      process.stdout.write('\rProgress: ' + Math.min(i + batchSize, data.length) + '/2000');
    }
  }
  console.log('\n\nLoad test complete.');
  console.log('Total successful requests (sent): ' + successCount);
  console.log('Check backend/logs/app.log for Wide Event records.');
}

run();
"

