#!/usr/bin/env node

// Скрипт для генерации секретных ключей
// Использование: node generate-keys.js

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function generateKey() {
  return crypto.randomBytes(32).toString("base64");
}

console.log("Generating secure keys for NeoLobbyst server...\n");

const jwtSecret = generateKey();
const apiKeySecret = generateKey();

console.log("Generated keys:");
console.log("=".repeat(60));
console.log(`JWT_SECRET=${jwtSecret}`);
console.log(`API_KEY_SECRET=${apiKeySecret}`);
console.log("=".repeat(60));

// Check if .env exists
const envPath = path.join(__dirname, ".env");
const envExamplePath = path.join(__dirname, ".env.example");

if (fs.existsSync(envPath)) {
  console.log("\n⚠️  Warning: .env file already exists!");
  console.log("Please manually update the following keys in your .env file:");
  console.log("  - JWT_SECRET");
  console.log("  - API_KEY_SECRET");
} else if (fs.existsSync(envExamplePath)) {
  // Create .env from .env.example
  let envContent = fs.readFileSync(envExamplePath, "utf8");

  // Replace placeholder values
  envContent = envContent.replace(/JWT_SECRET=.*/, `JWT_SECRET=${jwtSecret}`);
  envContent = envContent.replace(/API_KEY_SECRET=.*/, `API_KEY_SECRET=${apiKeySecret}`);

  fs.writeFileSync(envPath, envContent);
  console.log("\n✅ Created .env file with generated keys!");
  console.log("You can now start the server with: npm start");
} else {
  console.log("\n⚠️  .env.example not found!");
  console.log("Please create a .env file manually with the keys above.");
}

console.log("\n🔒 Security reminder:");
console.log("  - Never commit .env file to version control");
console.log("  - Keep these keys secret");
console.log("  - Use different keys for production and development");
console.log("  - Rotate keys periodically for better security\n");
