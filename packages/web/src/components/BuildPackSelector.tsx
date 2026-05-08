const PACKS = [
	{
		value: "nixpacks",
		label: "Nixpacks",
		desc: "Auto-detect framework via Nixpacks",
		tag: "NX",
	},
	{
		value: "static",
		label: "Static",
		desc: "Serve pre-built assets via nginx",
		tag: "ST",
	},
	{
		value: "dockerfile",
		label: "Dockerfile",
		desc: "Build and run a custom Dockerfile",
		tag: "DF",
	},
	{
		value: "dockercompose",
		label: "Docker Compose",
		desc: "Multi-service compose stack",
		tag: "DC",
	},
	{
		value: "dockerimage",
		label: "Docker Image",
		desc: "Pull and run a pre-built image",
		tag: "DI",
	},
] as const;

export type BuildPackValue = (typeof PACKS)[number]["value"];

interface Props {
	value: BuildPackValue;
	onChange: (v: BuildPackValue) => void;
}

export function BuildPackSelector({ value, onChange }: Props) {
	return (
		<fieldset>
			<legend className="font-mono text-xs tracking-widest text-ship-fog/70 uppercase mb-3">
				Build Pack
			</legend>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{PACKS.map((p) => {
					const selected = value === p.value;
					return (
						<button
							key={p.value}
							type="button"
							onClick={() => onChange(p.value)}
							className={[
								"relative flex flex-col items-start gap-1.5 p-3 rounded-sm border text-left transition-all duration-150",
								selected
									? "border-ship-buoy bg-ship-buoy/5"
									: "border-ship-deck/50 bg-ship-deck/10 hover:border-ship-deck",
							].join(" ")}
						>
							<span
								className={[
									"font-mono text-[10px] tracking-widest px-1.5 py-0.5 border",
									selected
										? "text-ship-buoy border-ship-buoy/40"
										: "text-ship-fog/70 border-ship-deck",
								].join(" ")}
							>
								{p.tag}
							</span>
							<span
								className={[
									"font-mono text-xs font-bold",
									selected ? "text-white" : "text-ship-fog",
								].join(" ")}
							>
								{p.label}
							</span>
							<span className="font-mono text-[10px] text-ship-fog/70 leading-tight">
								{p.desc}
							</span>
							{selected && (
								<span className="absolute -top-px -right-px w-1.5 h-1.5 bg-ship-buoy transition-opacity duration-75" />
							)}
						</button>
					);
				})}
			</div>
		</fieldset>
	);
}
