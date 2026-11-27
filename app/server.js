const express = require('express');
const os = require('os');
const client = require('prom-client');

const PORT = process.env.PORT || 8080;
const VERSION = process.env.APP_VERSION || 'dev';
const COLOR = process.env.COLOR || 'none';
// Failure switches for the Week 5 drills
const FAIL_HEALTH = process.env.FAIL_HEALTH === 'true';
const ERROR_RATE = parseFloat(process.env.ERROR_RATE || '0');

const app = express();

// Default process metrics (CPU, memory, event loop)
client.collectDefaultMetrics();

// The metric gate in Week 5 depends on these exact names
const requestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const requestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

// Measure real traffic only: skip /health and /metrics so
// ALB health checks and Prometheus scrapes don't skew the gate
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/metrics') return next();
  const stopTimer = requestDuration.startTimer();
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: req.route ? req.route.path : 'unmatched',
      status: String(res.statusCode),
    };
    requestsTotal.inc(labels);
    stopTimer(labels);
  });
  next();
});

app.get('/', (req, res) => {
  if (Math.random() < ERROR_RATE) {
    return res.status(500).json({ error: 'simulated failure', version: VERSION });
  }
  res.json({
    app: 'bluegreen-demo-app',
    version: VERSION,
    color: COLOR,
    host: os.hostname(),
  });
});

app.get('/health', (req, res) => {
  if (FAIL_HEALTH) return res.status(500).json({ status: 'unhealthy' });
  res.status(200).json({ status: 'ok' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

const server = app.listen(PORT, () => {
  console.log(`app listening on ${PORT} version=${VERSION} color=${COLOR}`);
});

// Clean shutdown, so instances terminated by the ASG finish in-flight requests
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
