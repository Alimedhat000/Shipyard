import { ArrowLeft, Loader2, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	BuildPackSelector,
	type BuildPackValue,
} from "../components/BuildPackSelector";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { useApp, useUpdateApp } from "../hooks/useApps";
import { useDeployApp } from "../hooks/useDeployments";

const LABELS: Record<string, string> = {
	name: "App Name",
	githubRepo: "GitHub Repo",
	branch: "Branch",
	buildPack: "Build Pack",
	buildCommand: "Build Command",
	outputDir: "Output Dir",
	subdirectory: "Subdirectory",
	port: "Port",
	runCommand: "Run Command",
	installCommand: "Install Command",
	dockerfilePath: "Dockerfile Path",
	isSpa: "SPA Fallback",
	isStatic: "Static Site",
	image: "Image",
};

function inputCls() {
	return "w-full bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors";
}

function AppSettingsContent() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const { data: app, isLoading } = useApp(id!);
	const updateApp = useUpdateApp();
	const deployApp = useDeployApp();
	const [dirty, setDirty] = useState(false);
	const [saved, setSaved] = useState(false);

	const [form, setForm] = useState<Record<string, any>>({});

	useEffect(() => {
		if (app) {
			setForm((prev) => {
				const merged: Record<string, any> = {};
				for (const key of Object.keys(LABELS)) {
					merged[key] = app[key] ?? prev[key] ?? "";
				}
				return merged;
			});
		}
	}, [app]);

	function set<K extends string>(key: K, val: (typeof form)[K]) {
		setForm((f) => ({ ...f, [key]: val }));
		setDirty(true);
		setSaved(false);
	}

	async function handleSave() {
		const payload: Record<string, unknown> = { id: id! };
		for (const key of Object.keys(form)) {
			const val = form[key];
			const original = app?.[key];
			if (val === original) continue;
			if (val === "" && (original === null || original === undefined)) continue;
			payload[key] = val;
		}
		if (Object.keys(payload).length === 1) return;
		await updateApp.mutateAsync(payload);
		setDirty(false);
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	}

	async function handleDeploy() {
		if (dirty) await handleSave();
		await deployApp.mutateAsync(id!);
	}

	if (isLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<Loader2 className="animate-spin text-ship-buoy" size={24} />
			</div>
		);
	}

	if (!app) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<p className="font-mono text-sm text-ship-fog/60">App not found</p>
			</div>
		);
	}

	const isStatic = form.buildPack === "nixpacks" && form.isStatic !== false;
	const isServer = form.buildPack === "nixpacks" && form.isStatic === false;

	return (
		<div className="min-h-screen bg-ship-deep">
			<div className="max-w-2xl mx-auto px-6 py-8">
				{/* Header */}
				<div className="flex items-center justify-between mb-8">
					<div className="flex items-center gap-4">
						<button
							type="button"
							onClick={() => navigate("/dashboard")}
							className="text-ship-fog/60 hover:text-ship-fog transition-colors"
						>
							<ArrowLeft size={20} />
						</button>
						<div>
							<h1 className="font-display text-xl font-bold text-white">
								{app.name}
							</h1>
							<p className="font-mono text-xs text-ship-fog/60 mt-0.5">
								{app.githubRepo}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{saved && (
							<span className="font-mono text-xs text-green-400">Saved</span>
						)}
						<button
							type="button"
							onClick={handleSave}
							disabled={!dirty || updateApp.isPending}
							className="font-mono text-xs text-ship-fog/70 hover:text-ship-fog disabled:opacity-30 px-3 py-2 border border-ship-deck/30 hover:border-ship-deck transition-colors"
						>
							{updateApp.isPending ? "SAVING..." : "SAVE"}
						</button>
						<button
							type="button"
							onClick={handleDeploy}
							disabled={deployApp.isPending}
							className="font-mono text-xs font-bold text-ship-deep bg-ship-buoy px-4 py-2 hover:bg-ship-buoy/90 disabled:opacity-40 transition-all flex items-center gap-1.5"
						>
							{deployApp.isPending ? (
								<Loader2 className="animate-spin" size={14} />
							) : (
								<Rocket size={14} />
							)}
							DEPLOY
						</button>
					</div>
				</div>

				{/* Form */}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSave();
					}}
					className="space-y-5"
				>
					{/* Name & Repo */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label>App Name</Label>
							<input
								value={form.name ?? ""}
								onChange={(e) => set("name", e.target.value)}
								className={inputCls()}
							/>
						</div>
						<div className="space-y-1.5">
							<Label>GitHub Repo</Label>
							<input
								value={form.githubRepo ?? ""}
								onChange={(e) => set("githubRepo", e.target.value)}
								className={inputCls()}
							/>
						</div>
					</div>

					{/* Branch */}
					<div className="space-y-1.5">
						<Label>Branch</Label>
						<input
							value={form.branch ?? "main"}
							onChange={(e) => set("branch", e.target.value)}
							className="w-full max-w-xs bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
						/>
					</div>

					{/* Build Pack */}
					<BuildPackSelector
						value={form.buildPack as BuildPackValue}
						onChange={(v) => set("buildPack", v)}
					/>

					{/* Build-specific fields */}
					<div className="space-y-3 border-t border-ship-deck/30 pt-4">
						{(isStatic || form.buildPack === "nixpacks") && (
							<>
								{isStatic && (
									<div className="space-y-1.5">
										<Label>Output Dir</Label>
										<input
											value={form.outputDir ?? ""}
											onChange={(e) => set("outputDir", e.target.value)}
											className={inputCls()}
										/>
									</div>
								)}

								<div className="space-y-1.5">
									<Label>Subdirectory</Label>
									<input
										value={form.subdirectory ?? ""}
										onChange={(e) => set("subdirectory", e.target.value)}
										placeholder="e.g. frontend, packages/web"
										className="max-w-xs bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
									/>
								</div>

								<div className="space-y-1.5">
									<Label>Build Command</Label>
									<input
										value={form.buildCommand ?? ""}
										onChange={(e) => set("buildCommand", e.target.value)}
										placeholder="npm run build"
										className={inputCls()}
									/>
								</div>
							</>
						)}

						{isStatic && (
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={form.isSpa === true}
									onChange={(e) => set("isSpa", e.target.checked)}
									className="w-3.5 h-3.5 accent-ship-buoy"
								/>
								<span className="font-mono text-xs text-ship-fog/70">
									SPA fallback (route all 404s to index.html)
								</span>
							</label>
						)}

						{isServer && (
							<div className="space-y-1.5">
								<Label>Run Command</Label>
								<input
									value={form.runCommand ?? ""}
									onChange={(e) => set("runCommand", e.target.value)}
									placeholder="npm start"
									className="max-w-xs bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
								/>
							</div>
						)}

						{form.buildPack === "dockerfile" && (
							<div className="space-y-1.5">
								<Label>Dockerfile Path</Label>
								<input
									value={form.dockerfilePath ?? "./Dockerfile"}
									onChange={(e) => set("dockerfilePath", e.target.value)}
									className={inputCls()}
								/>
							</div>
						)}

						{form.buildPack === "dockerimage" && (
							<div className="space-y-1.5">
								<Label>Image</Label>
								<input
									value={form.image ?? ""}
									onChange={(e) => set("image", e.target.value)}
									placeholder="nginx:alpine"
									className={inputCls()}
								/>
							</div>
						)}

						{/* Port — shown for all build packs */}
						<div className="space-y-1.5">
							<Label>Port</Label>
							<input
								type="number"
								value={form.port ?? 80}
								onChange={(e) =>
									set(
										"port",
										e.target.value === "" ? 0 : Number(e.target.value),
									)
								}
								min={1}
								max={65535}
								className="w-24 bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ship-buoy/50 transition-colors"
							/>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}

function Label({ children }: { children: string }) {
	return (
		<label className="block font-mono text-[10px] tracking-widest text-ship-fog uppercase">
			{children}
		</label>
	);
}

export function AppSettings() {
	return (
		<ProtectedRoute>
			<AppSettingsContent />
		</ProtectedRoute>
	);
}
