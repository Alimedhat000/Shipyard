import { Plus, Settings } from "lucide-react";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useAuth, useLogout } from "../hooks/useAuth";

function DashboardContent() {
	const { data: auth } = useAuth();
	const logout = useLogout();

	if (!auth) return null;

	return (
		<div className="min-h-screen">
			{/* Header */}
			<header className="bg-ship-dock/80 backdrop-blur-sm border-b border-ship-deck/50 px-6 py-4 flex justify-between items-center sticky top-0 z-50">
				<div>
					<h1 className="font-display text-xl font-bold text-ship-buoy">
						Shipyard
					</h1>
				</div>
				<div className="flex items-center gap-4">
					{auth.user.avatarUrl && (
						<img
							src={auth.user.avatarUrl}
							alt={auth.user.githubUsername}
							className="w-8 h-8 rounded-full border border-ship-deck"
						/>
					)}
					<span className="font-mono text-sm text-ship-fog">
						{auth.user.githubUsername}
					</span>
					<button
						type="button"
						className="text-ship-fog hover:text-ship-buoy transition-colors"
						onClick={() => alert("Settings coming soon")}
					>
						<Settings size={18} />
					</button>
					<button
						onClick={logout}
						type="button"
						className="font-mono text-xs text-ship-fog hover:text-ship-buoy border border-ship-deck px-3 py-1.5 hover:border-ship-buoy/50 transition-colors"
					>
						SIGN_OUT
					</button>
				</div>
			</header>

			{/* Main */}
			<main className="max-w-7xl mx-auto px-6 py-16">
				<div className="flex flex-col items-center justify-center min-h-[60vh]">
					<div className="flex flex-col items-center mb-6">
						<div className="font-mono text-8xl text-ship-deck/30 mb-2 select-none">
							∅
						</div>
						<h2 className="font-display text-3xl font-semibold text-ship-fog mb-3 text-center">
							No apps yet
						</h2>
						<p className="font-mono text-sm text-ship-fog/60 mb-10 max-w-md text-center">
							Connect a GitHub repository to deploy your first static site
						</p>
					</div>
					<button
						onClick={() => alert("Coming in Issue #3 — GitHub repo connection")}
						type="button"
						className="font-mono text-sm bg-ship-buoy text-ship-deep font-bold py-3 px-8 hover:bg-ship-buoy/90 transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,212,170,0.3)] flex items-center justify-center gap-2 group"
					>
						<Plus
							size={16}
							className="group-hover:rotate-90 transition-transform duration-300"
						/>
						CONNECT_REPO
					</button>
				</div>
			</main>
		</div>
	);
}

export function Dashboard() {
	return (
		<ProtectedRoute>
			<DashboardContent />
		</ProtectedRoute>
	);
}
