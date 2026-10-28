export default function NotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "80px auto", padding: "0 20px", font: "15px/1.55 system-ui, sans-serif", color: "#172033" }}>
      <h1 style={{ fontSize: 28, margin: "0 0 12px" }}>Page not found</h1>
      <p>This address is not part of GEM Copy Center.</p>
      <p><a href="/copy-trading" style={{ color: "#635bff", fontWeight: 700 }}>Open the Copy Center dashboard →</a></p>
    </main>
  );
}
