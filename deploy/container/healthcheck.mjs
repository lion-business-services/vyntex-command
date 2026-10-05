// Asks the server in this container whether it is alive. Used by the Dockerfile HEALTHCHECK, because the final image
// has no shell and no curl. Exit code 0 means healthy.
const port = Number(process.env.PORT || 8080);
const timer = setTimeout(() => process.exit(1), 4000);
try {
  const r = await fetch(`http://127.0.0.1:${port}/healthz`);
  clearTimeout(timer);
  process.exit(r.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
