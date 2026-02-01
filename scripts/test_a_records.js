const dns = require('dns');

const host = 'ac-kkxw3nz-shard-00-00.awflrhs.mongodb.net';
console.log(`Resolving A record for ${host} using default DNS`);

dns.resolve4(host, (err, addresses) => {
  if (err) {
    console.error('Error resolving A record:', err);
  } else {
    console.log('A Records:', addresses);
  }
});
