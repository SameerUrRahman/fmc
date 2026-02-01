const mongoose = require('mongoose');

// Constructed from previous DNS lookup of SRV record
const hosts = [
    'ac-kkxw3nz-shard-00-00.awflrhs.mongodb.net:27017',
    'ac-kkxw3nz-shard-00-01.awflrhs.mongodb.net:27017',
    'ac-kkxw3nz-shard-00-02.awflrhs.mongodb.net:27017'
];
const user = 'Sameer';
const pass = 'REDACTED_PASSWORD';
const standardUri = `mongodb://${user}:${pass}@${hosts.join(',')}/?ssl=true&authSource=admin&appName=Cluster0`;

async function testConnection() {
  console.log('Testing Standard Connection String (No SRV)...');
  console.log('URI:', standardUri.replace(pass, '****'));
  try {
    await mongoose.connect(standardUri, { serverSelectionTimeoutMS: 5000 });
    console.log('SUCCESS: Connected using Standard Connection String!');
    await mongoose.disconnect();
  } catch (err) {
    console.error('FAILURE:', err.message);
  }
}

testConnection();
