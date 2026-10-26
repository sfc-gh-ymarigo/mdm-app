import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { useUser } from './context/UserContext';
import { useBrand } from './config/BrandContext';
import Dashboard from './pages/Dashboard';
import CustomerList from './pages/CustomerList';
import ProductList from './pages/ProductList';
import DataQuality from './pages/DataQuality';
import Workflows from './pages/Workflows';
import MatchMerge from './pages/MatchMerge';
import AuditTrail from './pages/AuditTrail';
import Analyst from './pages/Analyst';
import GoldenRecords from './pages/GoldenRecords';
import DataProfiling from './pages/DataProfiling';
import Stewardship from './pages/Stewardship';
import ReferenceData from './pages/ReferenceData';
import Configuration from './pages/Configuration';
import EntityPage from './pages/modules/EntityPage';
import RecordPage from './pages/RecordPage';
import NotFound from './pages/NotFound';

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin, currentUser } = useUser();
  if (!currentUser) return null;
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const brand = useBrand();
  const modules = brand.modules || [];

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />

        {/* Module entity routes — config-driven (skip modules with dedicated pages) */}
        {modules.filter(m => m.enabled && !['customer', 'product'].includes(m.id)).map(m => (
          <Route key={m.id} path={`/${m.id}s`} element={<EntityPage moduleId={m.id} />} />
        ))}

        <Route path="/customers" element={<CustomerList />} />
        <Route path="/products" element={<ProductList />} />

        {/* Record pages for every enabled module: /customers/:id, /products/:id, /suppliers/:id … */}
        {modules.filter(m => m.enabled).map(m => (
          <Route key={`${m.id}-record`} path={`/${m.id}s/:id`} element={<RecordPage moduleId={m.id} />} />
        ))}

        {/* Static pages */}
        <Route path="/data-quality" element={<DataQuality />} />
        <Route path="/data-quality/rules/:ruleId" element={<DataQuality />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/:workflowId" element={<Workflows />} />
        <Route path="/match-merge" element={<MatchMerge />} />
        <Route path="/audit" element={<AuditTrail />} />
        <Route path="/golden" element={<GoldenRecords />} />
        <Route path="/golden/:goldenId" element={<GoldenRecords />} />
        <Route path="/analyst" element={<Analyst />} />
        <Route path="/profiling" element={<DataProfiling />} />
        <Route path="/stewardship" element={<Stewardship />} />
        <Route path="/reference-data" element={<ReferenceData />} />

        {/* Configuration (admin only) */}
        <Route path="/configuration" element={<RequireAdmin><Configuration /></RequireAdmin>} />
        <Route path="/configuration/:section" element={<RequireAdmin><Configuration /></RequireAdmin>} />
        <Route path="/configuration/:section/:subsection" element={<RequireAdmin><Configuration /></RequireAdmin>} />
        <Route path="/configuration/:section/:subsection/:tab" element={<RequireAdmin><Configuration /></RequireAdmin>} />

        {/* Backwards compat: redirect /admin → /configuration, /data-profiling → /profiling */}
        <Route path="/admin" element={<Navigate to="/configuration" replace />} />
        <Route path="/data-profiling" element={<Navigate to="/profiling" replace />} />

        {/* Modules load asynchronously: show 404 only once config is known */}
        <Route path="*" element={modules.length ? <NotFound /> : null} />
      </Route>
    </Routes>
  );
}
