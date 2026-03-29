const { execSync } = require('child_process');

const portsToKill = [5173, 18789, 3000];

console.log('🧹 [Launcher] Checking for ghost processes on ports:', portsToKill.join(', '));

portsToKill.forEach(port => {
  try {
    // macOS/Linux specific command to find PID on a port
    const pid = execSync(`lsof -t -i:${port}`).toString().trim();
    if (pid) {
      console.log(`⚠️   Found process ${pid} using port ${port}. Terminating...`);
      execSync(`kill -9 ${pid}`);
      console.log(`✅   Process ${pid} terminated.`);
    }
  } catch (error) {
    // error means lsof exited with non-zero, which means no process was found
    // we can safely ignore this
  }
});

console.log('✅ [Launcher] Clean up complete. Bringing up OpenClaw Services...');
