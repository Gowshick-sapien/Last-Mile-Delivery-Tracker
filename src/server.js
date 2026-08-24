const app = require('./app');
const { PORT } = require('./config/env');

app.listen(PORT, () => {
  console.log(`Last-Mile Delivery Tracker server running on port ${PORT}`);
  console.log(`Web Application: http://localhost:${PORT}`);
  console.log(`Health Check: http://localhost:${PORT}/health`);
});
