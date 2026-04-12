import { loadWebConfig } from '@echidna-claw/config/browser';

const config = loadWebConfig(import.meta.env as Record<string, string | undefined>);

export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Step 4 workflows</p>
        <h1>{config.appTitle}</h1>
        <p className="lede">
          The control plane shell is running with the local process loop, smoke checks, Compose
          integration, and deployment scaffolding that later feature work will rely on.
        </p>
      </section>
      <section className="facts">
        <article>
          <h2>API base URL</h2>
          <code>{config.apiBaseUrl}</code>
        </article>
        <article>
          <h2>App base URL</h2>
          <code>{config.appBaseUrl}</code>
        </article>
        <article>
          <h2>Runtime mode</h2>
          <p>{config.runtimeMode}</p>
        </article>
        <article>
          <h2>Workflow status</h2>
          <p>
            Developer startup, verification, packaging, and branch deployment policies are wired.
          </p>
        </article>
      </section>
    </main>
  );
}

export default App;
