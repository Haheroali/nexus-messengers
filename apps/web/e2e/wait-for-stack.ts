export default async function waitForDockerStack() {
  const checks = [
    `${process.env.NEXUS_API_URL ?? 'http://localhost:4000'}/health`,
    'http://localhost:3000/',
  ];
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      for (const url of checks) {
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`Stack probe failed (${response.status}): ${url}`);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw new Error('Timed out waiting for the NEXUS Docker stack', { cause: lastError });
}
