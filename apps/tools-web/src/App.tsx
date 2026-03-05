import { Navigate, Route, Routes } from 'react-router-dom';

function HomePage() {
  return (
    <main>
      <h1>tools.domain.xxx</h1>
      <p>Tools subsite bootstrap complete. Catalog page lands in the next milestone.</p>
    </main>
  );
}

function ToolEntryPage() {
  return (
    <main>
      <h1>Tool Entry</h1>
      <p>Dynamic tool entry route is wired.</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/:toolSlug" element={<ToolEntryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
