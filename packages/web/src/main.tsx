import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: 5 * 60 * 1000,
		},
	},
});

const router = createBrowserRouter([
	{
		path: "/login",
		lazy: async () => {
			const { Login } = await import("./pages/Login");
			return { Component: Login };
		},
	},
	{
		path: "/dashboard",
		lazy: async () => {
			const { Dashboard } = await import("./pages/Dashboard");
			return { Component: Dashboard };
		},
	},
	{
		path: "/app/:id",
		lazy: async () => {
			const { AppSettings } = await import("./pages/AppSettings");
			return { Component: AppSettings };
		},
	},
	{
		path: "/",
		lazy: async () => {
			const { HomeRedirect } = await import("./pages/HomeRedirect");
			return { Component: HomeRedirect };
		},
	},
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
