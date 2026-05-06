export function Login() {
	return (
		<div className="min-h-screen flex flex-col items-center justify-center px-6">
			{/* Logo */}
			<div className="mb-12 animate-pulse">
				<div className="font-display text-6xl font-bold text-ship-buoy tracking-tight">
					∅
				</div>
			</div>

			{/* Card */}
			<div className="w-full max-w-sm bg-ship-dock/80 backdrop-blur-sm border border-ship-deck px-6 py-16 text-center">
				<h2 className="font-display text-2xl font-semibold text-ship-fog mb-2">
					Welcome to Shipyard
				</h2>
				<p className="font-mono text-sm text-ship-fog/60 mb-8">
					Sign in to deploy your static sites
				</p>
				<button
					onClick={() => {
						window.location.href = "/api/auth/github";
					}}
					type="button"
					className="w-full bg-ship-buoy hover:bg-ship-buoy/90 text-ship-deep font-mono font-bold py-3 px-6 rounded-none border-2 border-ship-buoy transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,212,170,0.3)] flex items-center justify-center gap-3"
				>
					<img src="/github_icon.svg" alt="GitHub" width="20" height="20" />
					SIGN_IN_WITH_GITHUB
				</button>
			</div>
		</div>
	);
}
