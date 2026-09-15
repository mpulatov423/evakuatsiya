// Local development server only; production deploy uses static files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const requestedPort = Number(process.env.PORT || process.argv[2] || 5500);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json'
};

function handleRequest(request, response) {
  const requested = decodeURIComponent(request.url.split('?')[0]);
  const relative = requested === '/' ? '/index.html' : requested;
  const file = path.resolve(root, `.${relative}`);
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(data);
  });
}

function listen(port) {
  const server = http.createServer(handleRequest);
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && port < requestedPort + 10) {
      console.log(`${port}-port band. ${port + 1}-port tekshirilmoqda...`);
      listen(port + 1);
      return;
    }
    console.error(`Serverni ${port}-portda ishga tushirib bo‘lmadi: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Evakuatsiya prototipi: http://localhost:${port}`);
  });
}

listen(requestedPort);
