import { loadWebConfig } from '@echidna-claw/config/browser';

const config = loadWebConfig(import.meta.env as Record<string, string | undefined>);

export function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Step 1 baseline</p>
        <h1>{config.appTitle}</h1>
        <p className="lede">
          The control plane shell is running with a shared workspace, typed config, and minimal
          service scaffolds for the API, hands worker, and sandbox.
        </p>
      </section>
      <section className="facts">
        <article>
          <h2>API base URL</h2>
          <code>{config.apiBaseUrl}</code>
        </article>
        <article>
          <h2>Workspace status</h2>
          <p>Foundation scaffolding complete. Step 2 can now define real domain contracts.</p>
        </article>
      </section>
    </main>
  );
}

export default App;
