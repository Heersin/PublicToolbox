import { Navigate, Route, Routes } from 'react-router-dom';
import CatalogPage from './pages/CatalogPage';
import ToolEntryPage from './pages/ToolEntryPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/:toolSlug" element={<ToolEntryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
