import net from 'node:net';

export const DEVELOPMENT_PRODUCTS = Object.freeze({
  viewer: 'FreeTV Viewer',
  admin: 'FreeTV Admin Dashboard',
  php: 'PHP API Server',
});

export function resolveDevelopmentPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} has an invalid configured port: ${value}`);
  }
  return port;
}

function portUnavailableError(label, port) {
  return new Error(
    `${label} could not start.\n\nPort ${port} is already in use.\n`
    + 'See README.md > Troubleshooting for help.',
  );
}

export function assertDevelopmentPortAvailable({ label, port }) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(portUnavailableError(label, port));
        return;
      }
      reject(new Error(
        `${label} could not start.\n\nCould not check port ${port}: ${error.message}\n`
        + 'See README.md > Troubleshooting for help.',
      ));
    });
    probe.listen({ host: '0.0.0.0', port, exclusive: true }, () => {
      probe.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

export async function preflightDevelopmentPorts(services) {
  const claimedPorts = new Set();
  for (const service of services) {
    if (claimedPorts.has(service.port)) {
      throw portUnavailableError(service.label, service.port);
    }
    claimedPorts.add(service.port);
  }

  await Promise.all(services.map(assertDevelopmentPortAvailable));
}
