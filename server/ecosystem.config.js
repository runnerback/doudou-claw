module.exports = {
  apps: [{
    name: 'claw-api',
    script: 'src/index.js',
    cwd: '/var/www/claw/server',
    env: { NODE_ENV: 'production' },
    max_restarts: 10,
    restart_delay: 5000,
    error_file: '/var/log/pm2/claw-api.error.log',
    out_file: '/var/log/pm2/claw-api.out.log',
    time: true,
  }],
}
