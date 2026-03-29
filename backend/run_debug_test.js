const { execSync } = require('child_process');
try {
  execSync('npx vitest run tests/e2e/phase1-e2e.test.ts -t "E2E-DEB-02" --pool=forks', {
    stdio: 'inherit',
    env: { ...process.env, DEBUG: '1' } // maybe helps
  });
} catch (e) {
  process.exit(1);
}
