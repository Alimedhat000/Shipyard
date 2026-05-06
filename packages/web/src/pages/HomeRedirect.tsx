import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function HomeRedirect() {
	const { data: user, isLoading } = useAuth();

	if (isLoading) return null;
	return <Navigate to={user ? "/dashboard" : "/login"} replace />;
}
