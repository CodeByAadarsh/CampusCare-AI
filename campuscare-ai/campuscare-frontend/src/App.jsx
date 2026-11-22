import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ReportChat from './pages/student/ReportChat.jsx';
import MyReports from './pages/student/MyReports.jsx';
import IssueDetail from './pages/IssueDetail.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import IssueQueue from './pages/admin/IssueQueue.jsx';
import Duplicates from './pages/admin/Duplicates.jsx';
import NotFound from './pages/NotFound.jsx';

function RequireRole({ role, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/student/report'} replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/student/report'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      <Route element={<RequireRole role="student"><Layout /></RequireRole>}>
        <Route path="/student" element={<Navigate to="/student/report" replace />} />
        <Route path="/student/report" element={<ReportChat />} />
        <Route path="/student/reports" element={<MyReports />} />
        <Route path="/student/reports/:id" element={<IssueDetail />} />
      </Route>

      <Route element={<RequireRole role="admin"><Layout /></RequireRole>}>
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/issues" element={<IssueQueue />} />
        <Route path="/admin/issues/:id" element={<IssueDetail />} />
        <Route path="/admin/duplicates" element={<Duplicates />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
