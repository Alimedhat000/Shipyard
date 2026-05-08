import { Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { CreateAppModal } from "../components/CreateAppModal";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useApps, useDeleteApp } from "../hooks/useApps";
import { useAuth, useLogout } from "../hooks/useAuth";

const BUILD_PACK_COLORS: Record<string, string> = {
	nixpacks: "text-purple-400 border-purple-900/50 bg-purple-950/20",
	static: "text-ship-buoy border-ship-buoy/20 bg-ship-buoy/5",
	dockerfile: "text-blue-400 border-blue-900/50 bg-blue-950/20",
	dockercompose: "text-yellow-400 border-yellow-900/50 bg-yellow-950/20",
	dockerimage: "text-orange-400 border-orange-900/50 bg-orange-950/20",
};

const STATUS_DOT: Record<string, string> = {
	running: "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]",
	deploying: "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)] animate-pulse",
	failed: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
	idle: "bg-ship-fog/40",
};

function DashboardContent() {
	const { data: auth } = useAuth();
	const logout = useLogout();
	const { data: apps, isLoading } = useApps();
	const deleteApp = useDeleteApp();
	const [showCreate, setShowCreate] = useState(false);

	if (!auth) return null;

	const hasApps = apps && apps.length > 0;

	return (
		<div className="min-h-screen">
			{/* Header */}
			<header className="bg-ship-dock/80 backdrop-blur-sm border-b border-ship-deck/50 sticky top-0 z-50">
				<div className="max-w-6xl mx-auto px-6 py-3 flex justify-between items-center">
					<div className="flex items-center gap-4">
						<h1 className="font-display text-xl font-bold text-white tracking-tight">
							Shipyard
						</h1>
						{hasApps && (
							<span className="font-mono text-[10px] text-ship-fog/70 tracking-widest uppercase border-l border-ship-deck/30 pl-4">
								{apps.length} app{apps.length !== 1 ? "s" : ""} moored
							</span>
						)}
					</div>
					<div className="flex items-center gap-3">
						{auth.user.avatarUrl && (
							<img
								src={auth.user.avatarUrl}
								alt={auth.user.githubUsername}
								className="w-7 h-7 rounded-full border border-ship-deck"
							/>
						)}
						<span className="font-mono text-xs text-ship-fog">
							{auth.user.githubUsername}
						</span>
						<button
							type="button"
							className="text-ship-fog/70 hover:text-ship-fog transition-colors"
							onClick={() => alert("Settings coming soon")}
						>
							<Settings size={15} />
						</button>
						<button
							onClick={logout}
							type="button"
							className="font-mono text-[10px] tracking-widest text-ship-fog/70 hover:text-ship-fog border border-ship-deck/30 px-2.5 py-1 hover:border-ship-deck transition-colors"
						>
							SIGN_OUT
						</button>
					</div>
				</div>
			</header>

			{/* Main */}
			<main className="max-w-6xl mx-auto px-6 py-12">
				{isLoading ? (
					<div className="flex items-center justify-center min-h-[40vh]">
						<div className="font-mono text-xs text-ship-fog/40 animate-pulse tracking-widest uppercase">
							Loading manifest...
						</div>
					</div>
				) : hasApps ? (
					<div className="space-y-6">
						<div className="flex items-center justify-between">
							<div className="font-mono text-[10px] tracking-widest text-ship-fog/70 uppercase">
								Deployed Applications
							</div>
							<button
								onClick={() => setShowCreate(true)}
								type="button"
								className="font-mono text-xs font-bold text-ship-deep bg-ship-buoy px-3 py-1.5 hover:bg-ship-buoy/90 transition-all flex items-center gap-1.5"
							>
								<Plus size={13} />
								NEW APP
							</button>
						</div>

						<div className="grid gap-3">
							{apps.map((app: Record<string, unknown>) => (
								<AppCard
									key={app.id as string}
									app={app as unknown as AppData}
									onDelete={() => deleteApp.mutate(app.id as string)}
								/>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center justify-center min-h-[50vh]">
						<div className="mb-8 select-none flex flex-col items-center">
							<svg
								width="64"
								height="64"
								viewBox="0 0 64 64"
								fill="none"
								className="mb-6 text-ship-deck/40"
							>
								<rect
									x="8"
									y="16"
									width="48"
									height="36"
									rx="2"
									stroke="currentColor"
									strokeWidth="1.5"
									fill="none"
								/>
								<path d="M8 24h48" stroke="currentColor" strokeWidth="1.5" />
								<circle cx="16" cy="20" r="1.5" fill="currentColor" />
								<circle cx="21" cy="20" r="1.5" fill="currentColor" />
								<circle cx="26" cy="20" r="1.5" fill="currentColor" />
								<path
									d="M20 34l8 8 16-16"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
									opacity="0.5"
								/>
							</svg>
							<h2 className="font-display text-2xl font-bold text-ship-fog mb-2">
								No applications
							</h2>
							<p className="font-mono text-sm text-ship-fog/70 mb-8 max-w-md text-center leading-relaxed">
								Dry dock is empty. Deploy your first application
								<br />
								to get started.
							</p>
						</div>
						<button
							onClick={() => setShowCreate(true)}
							type="button"
							className="font-mono text-sm bg-ship-buoy text-ship-deep font-bold py-3 px-8 hover:bg-ship-buoy/90 transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,212,170,0.3)] flex items-center gap-2 group"
						>
							<Plus
								size={16}
								className="group-hover:rotate-90 transition-transform duration-300"
							/>
							NEW APPLICATION
						</button>
					</div>
				)}
			</main>

			<CreateAppModal open={showCreate} onClose={() => setShowCreate(false)} />
		</div>
	);
}

interface AppData {
	id: string;
	name: string;
	githubRepo: string;
	branch: string;
	buildPack: string;
	status?: string;
	createdAt: string;
}

function AppCard({ app, onDelete }: { app: AppData; onDelete: () => void }) {
	const [confirmDelete, setConfirmDelete] = useState(false);
	const status = (app.status ?? "idle") as string;
	const packColor =
		BUILD_PACK_COLORS[app.buildPack] ?? BUILD_PACK_COLORS.static;
	const dotColor = STATUS_DOT[status] ?? STATUS_DOT.idle;

	return (
		<div className="border border-ship-deck/40 bg-ship-dock/50 hover:border-ship-deck/70 transition-colors group">
			<div className="px-4 py-3 flex items-center justify-between gap-4">
				<div className="flex items-center gap-4 min-w-0">
					{/* Status LED */}
					<span className="relative flex-shrink-0 w-2 h-2">
						<span className={`absolute inset-0 rounded-full ${dotColor}`} />
					</span>

					{/* Info */}
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="font-mono text-sm font-bold text-white truncate">
								{app.name}
							</h3>
							<span
								className={`font-mono text-[10px] tracking-widest px-1.5 py-0.5 border flex-shrink-0 ${packColor}`}
							>
								{app.buildPack.toUpperCase()}
							</span>
						</div>
						<p className="font-mono text-xs text-ship-fog/70 mt-0.5">
							{app.githubRepo}
							<span className="mx-1.5 text-ship-deck">/</span>
							{app.branch}
						</p>
					</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
					{confirmDelete ? (
						<div className="flex items-center gap-1.5">
							<span className="font-mono text-[10px] text-red-400 tracking-widest">
								CONFIRM?
							</span>
							<button
								type="button"
								onClick={onDelete}
								className="font-mono text-[10px] tracking-widest text-red-400 border border-red-900/50 px-2 py-1 hover:bg-red-950/30 transition-colors"
							>
								YES
							</button>
							<button
								type="button"
								onClick={() => setConfirmDelete(false)}
								className="font-mono text-[10px] tracking-widest text-ship-fog/70 px-2 py-1 hover:text-ship-fog transition-colors"
							>
								NO
							</button>
						</div>
					) : (
						<>
							<button
								type="button"
								title="Deploy"
								className="font-mono text-[10px] tracking-widest text-ship-buoy/60 hover:text-ship-buoy border border-ship-buoy/20 hover:border-ship-buoy/40 px-2 py-1 transition-colors"
							>
								DEPLOY
							</button>
							<button
								type="button"
								title="Delete"
								onClick={() => setConfirmDelete(true)}
								className="text-ship-fog/60 hover:text-red-400 transition-colors"
							>
								<Trash2 size={14} />
							</button>
						</>
					)}
				</div>
			</div>
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
