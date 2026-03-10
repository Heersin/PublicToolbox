import { Navigate, Route, Routes } from 'react-router-dom';
import CatalogPage from './pages/CatalogPage';
import AgentBoardPage from './pages/AgentBoardPage';
import ClipboardPage from './pages/ClipboardPage';
import ToolEntryPage from './pages/ToolEntryPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CatalogPage />} />
      <Route path="/agent-board" element={<AgentBoardPage />} />
      <Route path="/clipboard" element={<ClipboardPage />} />
      <Route path="/clipboard/:phrase" element={<ClipboardPage />} />
      <Route path="/:toolSlug" element={<ToolEntryPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
