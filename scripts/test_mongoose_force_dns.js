const dns = require('dns');
const mongoose = require('mongoose');

// FORCE GOOGLE DNS
try {
  dns.setServers(['8.8.8.8']);
  console.log('Forced DNS to 8.8.8.8');
} catch (e) {
  console.error('Failed to set DNS servers:', e);
}

const uri = process.env.MONGODB_URI || 'mongodb+srv://REDACTED:REDACTED@REDACTED.mongodb.net/?appName=Cluster0';

async function testConnection() {
  console.log('Connecting to:', uri);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('SUCCESS: Connected to MongoDB with forced DNS!');
    await mongoose.disconnect();
  } catch (err) {
    console.error('FAILURE: Could not connect:', err.message);
  }
}

testConnection();
