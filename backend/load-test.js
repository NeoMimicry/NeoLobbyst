// Скрипт для нагрузочного тестирования сервера
// Использование: node load-test.js [concurrent-users] [duration-seconds]

const http = require("http");
const https = require("https");

const BASE_URL = process.env.TEST_URL || "http://localhost:3000";
const CONCURRENT_USERS = parseInt(process.argv[2]) || 100;
const DURATION_SECONDS = parseInt(process.argv[3]) || 60;

const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalResponseTime: 0,
  minResponseTime: Infinity,
  maxResponseTime: 0,
  errors: {}
};

let isRunning = true;

function makeRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === "https:" ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    };

    const startTime = Date.now();

    const req = client.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const responseTime = Date.now() - startTime;
        resolve({ statusCode: res.statusCode, body, responseTime });
      });
    });

    req.on("error", reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function simulateUser() {
  try {
    // 1. Register client
    const authRes = await makeRequest("POST", "/api/auth/register");
    if (authRes.statusCode !== 200) {
      throw new Error(`Auth failed: ${authRes.statusCode}`);
    }

    const { apiKey } = JSON.parse(authRes.body);
    const headers = { "X-API-Key": apiKey };

    stats.totalRequests++;
    stats.successfulRequests++;
    stats.totalResponseTime += authRes.responseTime;
    stats.minResponseTime = Math.min(stats.minResponseTime, authRes.responseTime);
    stats.maxResponseTime = Math.max(stats.maxResponseTime, authRes.responseTime);

    while (isRunning) {
      // 2. Create lobby
      const lobbyId = `lobby-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const createRes = await makeRequest(
        "POST",
        "/api/lobbies",
        {
          lobbyId,
          hostName: "Test Host",
          region: "EU",
          maxPlayers: 10,
          hasPassword: false,
          version: "1.0.0",
          password: ""
        },
        headers
      );

      stats.totalRequests++;
      if (createRes.statusCode === 201) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
        stats.errors[createRes.statusCode] = (stats.errors[createRes.statusCode] || 0) + 1;
      }
      stats.totalResponseTime += createRes.responseTime;
      stats.minResponseTime = Math.min(stats.minResponseTime, createRes.responseTime);
      stats.maxResponseTime = Math.max(stats.maxResponseTime, createRes.responseTime);

      // 3. Send heartbeat
      await new Promise((resolve) => setTimeout(resolve, 100));
      const heartbeatRes = await makeRequest(
        "POST",
        `/api/lobbies/${lobbyId}/heartbeat`,
        {
          playerCount: Math.floor(Math.random() * 10) + 1
        },
        headers
      );

      stats.totalRequests++;
      if (heartbeatRes.statusCode === 200) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
        stats.errors[heartbeatRes.statusCode] = (stats.errors[heartbeatRes.statusCode] || 0) + 1;
      }
      stats.totalResponseTime += heartbeatRes.responseTime;
      stats.minResponseTime = Math.min(stats.minResponseTime, heartbeatRes.responseTime);
      stats.maxResponseTime = Math.max(stats.maxResponseTime, heartbeatRes.responseTime);

      // 4. Get lobbies
      await new Promise((resolve) => setTimeout(resolve, 100));
      const listRes = await makeRequest("GET", "/api/lobbies", null, headers);

      stats.totalRequests++;
      if (listRes.statusCode === 200) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
        stats.errors[listRes.statusCode] = (stats.errors[listRes.statusCode] || 0) + 1;
      }
      stats.totalResponseTime += listRes.responseTime;
      stats.minResponseTime = Math.min(stats.minResponseTime, listRes.responseTime);
      stats.maxResponseTime = Math.max(stats.maxResponseTime, listRes.responseTime);

      // 5. Delete lobby
      await new Promise((resolve) => setTimeout(resolve, 100));
      const deleteRes = await makeRequest("DELETE", `/api/lobbies/${lobbyId}`, null, headers);

      stats.totalRequests++;
      if (deleteRes.statusCode === 200) {
        stats.successfulRequests++;
      } else {
        stats.failedRequests++;
        stats.errors[deleteRes.statusCode] = (stats.errors[deleteRes.statusCode] || 0) + 1;
      }
      stats.totalResponseTime += deleteRes.responseTime;
      stats.minResponseTime = Math.min(stats.minResponseTime, deleteRes.responseTime);
      stats.maxResponseTime = Math.max(stats.maxResponseTime, deleteRes.responseTime);

      // Wait before next cycle
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (err) {
    stats.failedRequests++;
    const errorMsg = err.message || "Unknown error";
    stats.errors[errorMsg] = (stats.errors[errorMsg] || 0) + 1;
  }
}

function printStats() {
  const avgResponseTime = stats.totalRequests > 0 ? (stats.totalResponseTime / stats.totalRequests).toFixed(2) : 0;
  const successRate = stats.totalRequests > 0 ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2) : 0;

  console.clear();
  console.log("=".repeat(60));
  console.log("NeoLobbyst Load Test Results");
  console.log("=".repeat(60));
  console.log(`Target URL: ${BASE_URL}`);
  console.log(`Concurrent Users: ${CONCURRENT_USERS}`);
  console.log(`Duration: ${DURATION_SECONDS}s`);
  console.log("-".repeat(60));
  console.log(`Total Requests: ${stats.totalRequests}`);
  console.log(`Successful: ${stats.successfulRequests} (${successRate}%)`);
  console.log(`Failed: ${stats.failedRequests}`);
  console.log("-".repeat(60));
  console.log(`Avg Response Time: ${avgResponseTime}ms`);
  console.log(`Min Response Time: ${stats.minResponseTime === Infinity ? 0 : stats.minResponseTime}ms`);
  console.log(`Max Response Time: ${stats.maxResponseTime}ms`);
  console.log(`Requests/sec: ${(stats.totalRequests / ((Date.now() - startTime) / 1000)).toFixed(2)}`);

  if (Object.keys(stats.errors).length > 0) {
    console.log("-".repeat(60));
    console.log("Errors:");
    for (const [error, count] of Object.entries(stats.errors)) {
      console.log(`  ${error}: ${count}`);
    }
  }
  console.log("=".repeat(60));
}

console.log(`Starting load test with ${CONCURRENT_USERS} concurrent users for ${DURATION_SECONDS} seconds...`);
console.log(`Target: ${BASE_URL}\n`);

const startTime = Date.now();

// Start concurrent users
const users = [];
for (let i = 0; i < CONCURRENT_USERS; i++) {
  users.push(simulateUser());
}

// Print stats every second
const statsInterval = setInterval(printStats, 1000);

// Stop after duration
setTimeout(() => {
  isRunning = false;
  clearInterval(statsInterval);

  // Wait for all users to finish
  Promise.all(users).then(() => {
    printStats();
    console.log("\nLoad test completed!");
    process.exit(0);
  });
}, DURATION_SECONDS * 1000);
