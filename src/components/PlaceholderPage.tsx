type PlaceholderPageProps = {
  title: string
  description: string
  endpoints: string[]
}

export function PlaceholderPage({ title, description, endpoints }: PlaceholderPageProps) {
  return (
    <section className="page-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Phase 3</p>
          <h2 className="section-title">{title}</h2>
        </div>
      </div>

      <p className="page-description">{description}</p>

      <div className="endpoint-block">
        <p className="endpoint-title">Available REST endpoints</p>
        <ul className="endpoint-list">
          {endpoints.map((endpoint) => (
            <li key={endpoint}>{endpoint}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
