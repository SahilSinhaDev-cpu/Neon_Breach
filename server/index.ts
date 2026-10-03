import { createGameServer, serveProduction } from './app';
const server = createGameServer(); serveProduction(server.app);
const port = Number(process.env.PORT || 3000);
server.http.listen(port, '0.0.0.0', () => console.log(`NEON BREACH real-time server listening on ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  const forced = setTimeout(() => process.exit(1), 5000); forced.unref();
  void server.close().then(() => process.exit(0));
});
