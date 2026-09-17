import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Skeleton } from "./components/ui/skeleton";
import { AppLayout, ProtectedRoute } from "./layouts/AppLayout";
import { PublicLayout } from "./layouts/PublicLayout";

const PublicPages = lazy(() => import("./pages/PublicPages"));
const AuthPages = lazy(() => import("./pages/AuthPages"));
const AppPages = lazy(() => import("./pages/AppPages"));

function LoadingRoute() {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingRoute />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<PublicPages page="home" />} />
          <Route path="platform" element={<PublicPages page="platform" />} />
          <Route path="how-it-works" element={<PublicPages page="how" />} />
          <Route path="research" element={<PublicPages page="research" />} />
          <Route path="pricing" element={<PublicPages page="pricing" />} />
          <Route path="docs" element={<PublicPages page="docs" />} />
          <Route path="blog" element={<PublicPages page="blog" />} />
          <Route path="blog/:slug" element={<PublicPages page="blog-detail" />} />
          <Route path="contact" element={<PublicPages page="contact" />} />
          <Route path="security" element={<PublicPages page="security" />} />
          <Route path="privacy" element={<PublicPages page="privacy" />} />
          <Route path="terms" element={<PublicPages page="terms" />} />
          <Route path="404" element={<PublicPages page="404" />} />
        </Route>
        <Route path="login" element={<AuthPages page="login" />} />
        <Route path="signup" element={<AuthPages page="signup" />} />
        <Route path="verify-email" element={<AuthPages page="verify-email" />} />
        <Route path="forgot-password" element={<AuthPages page="forgot-password" />} />
        <Route path="reset-password" element={<AuthPages page="reset-password" />} />
        <Route
          path="app"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AppPages page="dashboard" />} />
          <Route path="projects" element={<AppPages page="projects" />} />
          <Route path="projects/new" element={<AppPages page="project-new" />} />
          <Route path="projects/:projectId" element={<AppPages page="project-detail" />} />
          <Route path="projects/:projectId/environments" element={<AppPages page="environments" />} />
          <Route path="projects/:projectId/journeys" element={<AppPages page="journeys" />} />
          <Route path="projects/:projectId/journeys/new" element={<AppPages page="journey-new" />} />
          <Route path="projects/:projectId/journeys/:journeyId" element={<AppPages page="journey-detail" />} />
          <Route path="projects/:projectId/agents" element={<AppPages page="agents" />} />
          <Route path="experiments" element={<AppPages page="experiments" />} />
          <Route path="projects/:projectId/experiments" element={<AppPages page="project-experiments" />} />
          <Route path="projects/:projectId/experiments/new" element={<AppPages page="experiment-new" />} />
          <Route path="experiments/:runId" element={<AppPages page="experiment-detail" />} />
          <Route path="experiments/:runId/trajectories" element={<AppPages page="trajectories" />} />
          <Route path="experiments/:runId/failures" element={<AppPages page="failures" />} />
          <Route path="experiments/:runId/patches" element={<AppPages page="patches" />} />
          <Route path="experiments/:runId/confirmation" element={<AppPages page="confirmation" />} />
          <Route path="experiments/:runId/report" element={<AppPages page="run-report" />} />
          <Route path="certificates" element={<AppPages page="certificates" />} />
          <Route path="reports" element={<AppPages page="reports" />} />
          <Route path="integrations" element={<AppPages page="integrations" />} />
          <Route path="team" element={<AppPages page="team" />} />
          <Route path="settings/profile" element={<AppPages page="settings-profile" />} />
          <Route path="settings/security" element={<AppPages page="settings-security" />} />
          <Route path="settings/organization" element={<AppPages page="settings-organization" />} />
          <Route path="billing" element={<AppPages page="billing" />} />
          <Route path="audit-logs" element={<AppPages page="audit-logs" />} />
        </Route>
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  );
}
