export default function HealthPage() {
  return (
    <section className="card">
      <h2>System Health</h2>
      <ul>
        <li>API — GET /health/live and /health/ready</li>
        <li>Realtime — GET /health/live and /health/ready</li>
        <li>PostgreSQL and Redis via Docker Compose locally</li>
      </ul>
    </section>
  );
}
