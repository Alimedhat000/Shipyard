import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useCreateApp } from "../hooks/useApps";
import { BuildPackSelector, type BuildPackValue } from "./BuildPackSelector";

function parseGithubUrl(
	val: string,
): { repo: string; branch?: string; subdirectory?: string } | null {
	const match = val.match(GITHUB_URL_RE);
	if (!match) return null;

	const repo = match[1];
	const rest = match[2];

	if (!rest) return { repo };

	const parts = rest.split("/");
	const branch = parts[0];
	const subdirectory = parts.slice(1).join("/") || undefined;
	return { repo, branch, subdirectory };
}

const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_URL_RE =
	/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\/tree\/([\w.\-/]+))?$/;

const EXAMPLES = [
	{ label: "Pure HTML", sub: "static" },
	{ label: "Vue SPA", sub: "vue/spa" },
	{ label: "Vue SPA Router", sub: "vue/spa-router" },
	{ label: "Vue SSR", sub: "vue/ssr" },
	{ label: "Astro Static", sub: "astro/static" },
	{ label: "Astro Server", sub: "astro/server" },
	{ label: "Next.js SPA", sub: "nextjs/spa" },
	{ label: "Next.js SPA (standalone)", sub: "nextjs/spa-standalone" },
	{ label: "Next.js SPA + img opt", sub: "nextjs/spa-with-image-optimization" },
	{ label: "Next.js SSR", sub: "nextjs/ssr" },
	{ label: "Next.js Prisma", sub: "nextjs/prisma" },
	{ label: "Nuxt Static", sub: "nuxt/static" },
	{ label: "Nuxt Server", sub: "nuxt/server" },
	{ label: "Nuxt Nitro", sub: "nuxt/nitro" },
	{ label: "Remix", sub: "remix" },
	{ label: "Vite Vanilla JS", sub: "vite/vanilla-js" },
	{ label: "Vite Vanilla TS", sub: "vite/vanilla-ts" },
	{ label: "Bun", sub: "bun" },
	{ label: "Laravel", sub: "laravel" },
	{ label: "Laravel Inertia", sub: "laravel-inertia" },
	{ label: "Laravel Pure", sub: "laravel-pure" },
	{ label: "AdonisJS", sub: "adonisjs/simple" },
	{ label: "NestJS", sub: "nestjs" },
	{ label: "Node.js", sub: "nodejs" },
	{ label: "Flask", sub: "flask" },
	{ label: "Go Gin", sub: "go/gin" },
	{ label: "Rust", sub: "rust" },
	{ label: "Elixir Phoenix", sub: "elixir-phoenix" },
	{ label: "Symfony", sub: "symfony" },
	{ label: "Strapi", sub: "strapi" },
	{ label: "Rails", sub: "rails-example" },
	{ label: "t3 App", sub: "t3-app" },
	{ label: "t3 App + NextAuth", sub: "t3-nextauth" },
	{ label: "Turbo Next.js", sub: "turbo-nextjs" },
	{ label: "Turbo t3 NextAuth", sub: "turbo-t3-nextauth" },
	{ label: "Shopware 6", sub: "shopware6" },
] as const;

function validate(input: {
	name: string;
	githubRepo: string;
	buildPack: BuildPackValue;
	isStatic: boolean;
	image: string;
	port: number;
	outputDir: string;
	subdirectory: string;
	dockerfilePath: string;
}): Record<string, string> {
	const errs: Record<string, string> = {};

	if (!input.name.trim()) {
		errs.name = "App name is required";
	} else if (input.name.length > 255) {
		errs.name = "App name must be under 255 characters";
	}

	if (input.buildPack !== "dockerimage") {
		if (!input.githubRepo.trim()) {
			errs.githubRepo = "GitHub repo is required";
		} else if (!GITHUB_REPO_RE.test(input.githubRepo.trim())) {
			errs.githubRepo = "Must be in owner/repo format";
		}
	}

	if (input.buildPack === "dockerimage" && !input.image.trim()) {
		errs.image = "Image is required for Docker Image build pack";
	}

	if (
		input.buildPack === "nixpacks" &&
		input.isStatic &&
		!input.outputDir.trim()
	) {
		errs.outputDir = "Output directory is required";
	}

	if (input.buildPack === "dockerfile" && !input.dockerfilePath.trim()) {
		errs.dockerfilePath = "Dockerfile path is required";
	}

	if (!Number.isFinite(input.port) || input.port < 1 || input.port > 65535) {
		errs.port = "Port must be between 1 and 65535";
	}

	return errs;
}

function FieldError({ msg }: { msg?: string }) {
	if (!msg) return null;
	return (
		<p className="font-mono text-[11px] text-red-400 leading-tight mt-1">
			{msg}
		</p>
	);
}

function inputCls(hasError?: boolean) {
	return [
		"w-full bg-ship-deep border px-3 py-2 font-mono text-sm text-white",
		"placeholder:text-ship-deck focus:outline-none transition-colors",
		hasError
			? "border-red-800/70 focus:border-red-600"
			: "border-ship-deck/50 focus:border-ship-buoy/50",
	].join(" ");
}

interface Props {
	open: boolean;
	onClose: () => void;
}

export function CreateAppModal({ open, onClose }: Props) {
	const [buildPack, setBuildPack] = useState<BuildPackValue>("nixpacks");
	const [isStatic, setIsStatic] = useState(true);
	const [name, setName] = useState("");
	const [githubRepo, setGithubRepo] = useState("");
	const [branch, setBranch] = useState("main");
	const [buildCommand, setBuildCommand] = useState("");
	const [outputDir, setOutputDir] = useState("dist");
	const [subdirectory, setSubdirectory] = useState("");
	const [port, setPort] = useState(80);
	const [runCommand, setRunCommand] = useState("");
	const [dockerfilePath, setDockerfilePath] = useState("./Dockerfile");
	const [isSpa, setIsSpa] = useState(true);
	const [image, setImage] = useState("");
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const createApp = useCreateApp();
	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			setName("");
			setGithubRepo("");
			setBranch("main");
			setBuildPack("nixpacks");
			setIsStatic(true);
			setBuildCommand("");
			setOutputDir("dist");
			setSubdirectory("");
			setPort(80);
			setRunCommand("");
			setDockerfilePath("./Dockerfile");
			setIsSpa(true);
			setImage("");
			setSubmitError(null);
			setFieldErrors({});
			setTimeout(() => nameInputRef.current?.focus(), 100);
		}
	}, [open]);

	// Auto-set branch to v4.x when using the coolify-examples repo
	useEffect(() => {
		if (githubRepo === "coollabsio/coolify-examples") {
			setBranch("v4.x");
		}
	}, [githubRepo]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitError(null);

		const errs = validate({
			name,
			githubRepo,
			buildPack,
			isStatic,
			image,
			port,
			outputDir,
			subdirectory,
			dockerfilePath,
		});
		setFieldErrors(errs);
		if (Object.keys(errs).length > 0) return;

		const payload: Record<string, unknown> = {
			name,
			buildPack,
			port,
		};

		if (buildPack !== "dockerimage") {
			payload.githubRepo = githubRepo;
			payload.branch = branch;
		}

		if (buildCommand) payload.buildCommand = buildCommand;

		if (buildPack === "nixpacks") {
			payload.isStatic = isStatic;
			if (isStatic) {
				payload.outputDir = outputDir;
				payload.isSpa = isSpa;
				if (subdirectory) payload.subdirectory = subdirectory;
			} else {
				if (runCommand) payload.runCommand = runCommand;
				if (outputDir) payload.outputDir = outputDir;
				if (subdirectory) payload.subdirectory = subdirectory;
			}
		}

		if (buildPack === "dockerfile") {
			payload.dockerfilePath = dockerfilePath;
		}

		if (buildPack === "dockerimage") {
			payload.image = image;
		}

		try {
			await createApp.mutateAsync(payload);
			onClose();
		} catch (err) {
			setSubmitError(
				err instanceof Error ? err.message : "Failed to create app",
			);
		}
	}

	return (
		<AnimatePresence>
			{open && (
				<div className="fixed inset-0 z-[60] flex items-start justify-center pt-[5vh] pb-[5vh] overflow-y-auto">
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.1 }}
						className="fixed inset-0 bg-ship-deep/80 backdrop-blur-sm"
						onClick={onClose}
					/>
					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 4 }}
						transition={{
							duration: 0.14,
							ease: [0.2, 0.8, 0.2, 1],
						}}
						className="relative w-full max-w-xl border border-ship-deck bg-ship-dock shadow-2xl my-auto"
					>
						{/* Header */}
						<div className="flex items-center justify-between p-5 border-b border-ship-deck/50">
							<div className="flex items-center gap-3">
								<span className="font-mono text-[10px] tracking-widest text-ship-buoy uppercase">
									New Work Order
								</span>
							</div>
							<button
								type="button"
								onClick={onClose}
								className="font-mono text-xs text-ship-fog/60 hover:text-ship-fog transition-colors"
							>
								ESC
							</button>
						</div>

						<form onSubmit={handleSubmit} className="p-5 space-y-5" noValidate>
							{/* Name & Repo */}
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1.5">
									<label
										htmlFor="app-name"
										className="font-mono text-[10px] tracking-widest text-ship-fog uppercase"
									>
										App Name *
									</label>
									<input
										id="app-name"
										ref={nameInputRef}
										value={name}
										onChange={(e) => {
											setName(e.target.value);
											if (fieldErrors.name)
												setFieldErrors((p) => ({ ...p, name: "" }));
										}}
										placeholder="my-app"
										className={inputCls(!!fieldErrors.name)}
									/>
									<FieldError msg={fieldErrors.name} />
								</div>
								{buildPack !== "dockerimage" && (
									<div className="space-y-1.5">
										<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
											GitHub Repo *
										</label>
										<input
											value={githubRepo}
											onChange={(e) => {
												const val = e.target.value;
												setGithubRepo(val);
												const parsed = parseGithubUrl(val);
												if (parsed) {
													setGithubRepo(parsed.repo);
													if (parsed.branch) setBranch(parsed.branch);
													if (parsed.subdirectory)
														setSubdirectory(parsed.subdirectory);
												}
												if (fieldErrors.githubRepo)
													setFieldErrors((p) => ({ ...p, githubRepo: "" }));
											}}
											placeholder="user/repo"
											className={inputCls(!!fieldErrors.githubRepo)}
										/>
										<FieldError msg={fieldErrors.githubRepo} />
									</div>
								)}
							</div>

							{buildPack !== "dockerimage" && (
								<div className="space-y-1.5">
									<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
										Branch
									</label>
									<input
										value={branch}
										onChange={(e) => setBranch(e.target.value)}
										className="w-full max-w-xs bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
									/>
								</div>
							)}

							<BuildPackSelector value={buildPack} onChange={setBuildPack} />

							{/* Conditional fields */}
							<motion.div
								layout="position"
								transition={{ duration: 0.12 }}
								className="space-y-3 border-t border-ship-deck/30 pt-4 overflow-hidden"
							>
								<AnimatePresence mode="popLayout">
									{buildPack === "nixpacks" && (
										<>
											<motion.div
												key="static-toggle"
												initial={{ opacity: 0, y: 4 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0, y: 2 }}
												transition={{ duration: 0.1 }}
											>
												<label className="flex items-center gap-2 cursor-pointer mb-3">
													<input
														type="checkbox"
														checked={isStatic}
														onChange={(e) => setIsStatic(e.target.checked)}
														className="w-3.5 h-3.5 accent-ship-buoy"
													/>
													<span className="font-mono text-xs text-ship-fog/70">
														Static Site — serve output directory via nginx
													</span>
												</label>
											</motion.div>

											<motion.div
												key="output-and-build"
												initial={{ opacity: 0, y: 4 }}
												animate={{ opacity: 1, y: 0 }}
												exit={{ opacity: 0, y: 2 }}
												transition={{ duration: 0.1 }}
												className="grid grid-cols-2 gap-3"
											>
												{isStatic && (
													<div className="space-y-1.5">
														<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
															Output Dir *
														</label>
														<input
															value={outputDir}
															onChange={(e) => {
																setOutputDir(e.target.value);
																if (fieldErrors.outputDir)
																	setFieldErrors((p) => ({
																		...p,
																		outputDir: "",
																	}));
															}}
															placeholder="dist"
															className={inputCls(!!fieldErrors.outputDir)}
														/>
														<FieldError msg={fieldErrors.outputDir} />
													</div>
												)}
												{githubRepo === "coollabsio/coolify-examples" ? (
													<div className="space-y-1.5">
														<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
															Example App
														</label>
														<select
															value={subdirectory}
															onChange={(e) => {
																setSubdirectory(e.target.value);
																setName(e.target.value.replace("/", "-"));
															}}
															className="w-full bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white focus:outline-none focus:border-ship-buoy/50 transition-colors"
														>
															<option value="">Select an example...</option>
															{EXAMPLES.map((ex) => (
																<option key={ex.sub} value={ex.sub}>
																	{ex.label} ({ex.sub})
																</option>
															))}
														</select>
													</div>
												) : (
													<div className="space-y-1.5">
														<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
															Subdirectory
														</label>
														<input
															value={subdirectory}
															onChange={(e) => setSubdirectory(e.target.value)}
															placeholder="e.g. frontend, packages/web"
															className="w-full bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
														/>
													</div>
												)}
												<div className="space-y-1.5">
													<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
														Build Command
													</label>
													<input
														value={buildCommand}
														onChange={(e) => setBuildCommand(e.target.value)}
														placeholder="npm run build"
														className="w-full bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
													/>
												</div>
											</motion.div>

											{isStatic && (
												<motion.div
													key="spa-toggle"
													initial={{ opacity: 0, y: 4 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: 2 }}
													transition={{ duration: 0.1 }}
												>
													<label className="flex items-center gap-2 cursor-pointer">
														<input
															type="checkbox"
															checked={isSpa}
															onChange={(e) => setIsSpa(e.target.checked)}
															className="w-3.5 h-3.5 accent-ship-buoy"
														/>
														<span className="font-mono text-xs text-ship-fog/70">
															SPA fallback (route all 404s to index.html)
														</span>
													</label>
												</motion.div>
											)}

											{!isStatic && (
												<motion.div
													key="run-command"
													initial={{ opacity: 0, y: 4 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, y: 2 }}
													transition={{ duration: 0.1 }}
													className="space-y-1.5"
												>
													<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
														Run Command (override)
													</label>
													<input
														value={runCommand}
														onChange={(e) => setRunCommand(e.target.value)}
														placeholder="npm start"
														className="w-full max-w-xs bg-ship-deep border border-ship-deck/50 px-3 py-2 font-mono text-sm text-white placeholder:text-ship-deck focus:outline-none focus:border-ship-buoy/50 transition-colors"
													/>
												</motion.div>
											)}
										</>
									)}

									{buildPack === "dockerfile" && (
										<motion.div
											key="dockerfile-path"
											initial={{ opacity: 0, y: 4 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 2 }}
											transition={{ duration: 0.1 }}
											className="space-y-1.5"
										>
											<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
												Dockerfile Path *
											</label>
											<input
												value={dockerfilePath}
												onChange={(e) => {
													setDockerfilePath(e.target.value);
													if (fieldErrors.dockerfilePath)
														setFieldErrors((p) => ({
															...p,
															dockerfilePath: "",
														}));
												}}
												className={inputCls(!!fieldErrors.dockerfilePath)}
											/>
											<FieldError msg={fieldErrors.dockerfilePath} />
										</motion.div>
									)}

									{buildPack === "dockerimage" && (
										<motion.div
											key="image-field"
											initial={{ opacity: 0, y: 4 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 2 }}
											transition={{ duration: 0.1 }}
											className="space-y-1.5"
										>
											<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
												Image *
											</label>
											<input
												value={image}
												onChange={(e) => {
													setImage(e.target.value);
													if (fieldErrors.image)
														setFieldErrors((p) => ({ ...p, image: "" }));
												}}
												placeholder="nginx:alpine"
												className={inputCls(!!fieldErrors.image)}
											/>
											<FieldError msg={fieldErrors.image} />
										</motion.div>
									)}
								</AnimatePresence>

								<div className="space-y-1.5">
									<label className="font-mono text-[10px] tracking-widest text-ship-fog uppercase">
										Port
									</label>
									<input
										type="number"
										value={port}
										onChange={(e) => {
											const val = e.target.value;
											setPort(val === "" ? 0 : Number(val));
											if (fieldErrors.port)
												setFieldErrors((p) => ({ ...p, port: "" }));
										}}
										min={1}
										max={65535}
										className={inputCls(!!fieldErrors.port)}
									/>
									<FieldError msg={fieldErrors.port} />
								</div>
							</motion.div>

							{/* Submit error */}
							<AnimatePresence>
								{submitError && (
									<motion.div
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -4 }}
										className="border border-red-900/50 bg-red-950/20 px-3 py-2"
									>
										<span className="font-mono text-xs text-red-400">
											{submitError}
										</span>
									</motion.div>
								)}
							</AnimatePresence>

							{/* Actions */}
							<div className="flex items-center justify-between border-t border-ship-deck/30 pt-4">
								<span className="font-mono text-[10px] text-ship-fog/50 tracking-widest uppercase">
									* Required
								</span>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={onClose}
										className="font-mono text-xs text-ship-fog/60 hover:text-ship-fog px-3 py-2 border border-ship-deck/30 hover:border-ship-deck transition-colors"
									>
										Cancel
									</button>
									<button
										type="submit"
										disabled={createApp.isPending}
										className="font-mono text-xs font-bold text-ship-deep bg-ship-buoy px-4 py-2 hover:bg-ship-buoy/90 disabled:opacity-40 transition-all"
									>
										{createApp.isPending ? "CREATING..." : "CREATE APP"}
									</button>
								</div>
							</div>
						</form>
					</motion.div>
				</div>
			)}
		</AnimatePresence>
	);
}
