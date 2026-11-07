export const metadata = { title: "Branchline · Price Tag Generator", description: "Branchline Price Tag Generator" };\n\nconst migrationAreas = [
  "Universal Login and account authentication",
  "System Admin, Branch Admin, and Branch User permissions",
  "Branch session validation and force logout",
  "Product database and SRP management",
  "Price memo import, search, and controlled deletion",
  "Logo management and Supabase Storage",
  "All approved price-tag layouts and print calculations",
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BRANCHLINE · PLATFORM MIGRATION</p>
        <h1>Price Tag Generator</h1>
        <p className="intro">
          The new platform is being prepared. The existing Apps Script PTG
          remains the production system while the replacement is developed
          and verified.
        </p>
        <p className="intro"><a href="/login" style={{ color: "white", fontWeight: 800 }}>Open secure login →</a></p>
        <div className="status">
          <span className="status-dot" />
          Development scaffold · Not yet connected to production data
        </div>
      </section>

      <section className="panel">
        <h2>Migration scope</h2>
        <ul>
          {migrationAreas.map((area) => (
            <li key={area}>{area}</li>
          ))}
        </ul>
      </section>

      <footer>
        <strong>BRANCHLINE</strong>
        <span>Independent development environment · No production data loaded</span>
      </footer>
    </main>
  );
}
