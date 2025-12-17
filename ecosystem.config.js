// daiko/ecosystem.config.js

module.exports = {
  apps: [{
    name: 'Daiko',
    script: 'server.js', // o el archivo principal de tu app
    // instances: 'max', // usar todos los cores disponibles
    exec_mode: 'fork', // modo cluster para mejor rendimiento
    env: {
      NODE_ENV: 'development',
      PORT: 3030
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3030
    }
  }]
};
