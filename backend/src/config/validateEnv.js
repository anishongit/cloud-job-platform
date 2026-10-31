module.exports = () => {
  const required = [
    'DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PORT',
    'JWT_SECRET', 'REDIS_URL'
  ];
  const missing = required.filter(k => process.env[k] === undefined || process.env[k] === null || process.env[k] === '');
  
  if (process.env.DB_PASSWORD === undefined) {
    missing.push('DB_PASSWORD');
  }

  if (missing.length) {
    console.error('Missing env variables:', missing.join(', '));
    process.exit(1);
  }
};
