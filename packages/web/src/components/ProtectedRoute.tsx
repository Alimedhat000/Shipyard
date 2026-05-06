import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { data: user, isLoading } = useAuth();

	if (isLoading) {
		return (
			<div className="min-h-screen bg-ship-deep flex items-center justify-center">
				<div className="font-mono text-ship-fog text-sm animate-pulse">
					{/* /// loading_shipyard... */}loading_shipyard...
				</div>
			</div>
		);
	}

	if (!user) return <Navigate to="/login" replace />;
	return <>{children}</>;
}
