const dns = require('dns');
try {
  dns.setServers(['8.8.8.8']);
} catch(e) { console.log('Could not set custom DNS servers'); }



console.log('Resolving SRV for _mongodb._tcp.cluster0.awflrhs.mongodb.net');
dns.resolveSrv('_mongodb._tcp.cluster0.awflrhs.mongodb.net', (err, addresses) => {
  if (err) {
    console.error('Error resolving SRV:', err);
  } else {
    console.log('SRV Records:', addresses);
  }
});
