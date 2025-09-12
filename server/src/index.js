const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('colyseus');
const { DemoRoom } = require('./rooms/DemoRoom');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('/health', (_req, res) => res.send('ok'));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const server = http.createServer(app);
const gameServer = new Server({ server });
gameServer.define('demo', DemoRoom);

const port = process.env.PORT || 2567;
server.listen(port, () => {
  console.log(`[weave-demo] listening on http://localhost:${port}`);
  console.log(`[weave-demo] static served from ${publicDir}`);
});
