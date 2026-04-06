import { networkInterfaces } from 'os';
import { spawn } from 'child_process';

const nets = networkInterfaces();
let ip = 'localhost';

// Detect the first non-internal IPv4 address
for (const name of Object.keys(nets)) {
  for (const net of nets[name]) {
    // In Node 18+, net.family is 'IPv4' or 'IPv6'
    // Before Node 18, it could be 4 or 6
    if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
      ip = net.address;
      break;
    }
  }
  if (ip !== 'localhost') break;
}

console.log(`📡 Local Network Discovery: Detected IP ${ip}`);
console.log(`🚀 Starting Next.js bound to ${ip}:3000...`);

// Spawn next dev with the detected IP
const next = spawn('npx', ['next', 'dev', '--hostname', ip, '--port', '3000'], {
  stdio: 'inherit',
  shell: true,
});

next.on('error', (err) => {
  console.error('Failed to start Next.js:', err);
});
