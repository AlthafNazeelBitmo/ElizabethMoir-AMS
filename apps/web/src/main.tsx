import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  RouterProvider,
  createBrowserRouter,
  Navigate,
} from "react-router-dom";
import { App } from "./App.js";
import { applyTheme } from "./lib/theme.js";
import { LoginPage } from "./routes/LoginPage.js";
import { RegisterPage } from "./routes/RegisterPage.js";
import { ReportsPage } from "./routes/ReportsPage.js";
import { PersonReportPage } from "./routes/PersonReportPage.js";
import { AdminPage } from "./routes/AdminPage.js";
import { ChangePasswordPage } from "./routes/ChangePasswordPage.js";
import "./index.css";

// Before the first paint, so a dark-mode user never sees a white flash.
applyTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The register is kept current by the event stream, not by polling.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/register" replace /> },
      { path: "register", element: <RegisterPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "reports/person/:id", element: <PersonReportPage /> },
      { path: "admin", element: <Navigate to="/admin/people" replace /> },
      { path: "admin/:section", element: <AdminPage /> },
      { path: "change-password", element: <ChangePasswordPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
