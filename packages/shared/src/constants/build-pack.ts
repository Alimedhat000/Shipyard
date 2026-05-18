export const BUILD_PACKS = [
	"nixpacks",
	"dockerfile",
	"dockercompose",
	"dockerimage",
] as const;

export type BuildPack = (typeof BUILD_PACKS)[number];

export const BUILD_PACK_LABELS: Record<BuildPack, string> = {
	nixpacks: "Nixpacks (auto-detect)",
	dockerfile: "Dockerfile",
	dockercompose: "Docker Compose",
	dockerimage: "Docker Image",
};

export const BUILD_PACK_DESCRIPTIONS: Record<BuildPack, string> = {
	nixpacks:
		"Automatic detection and building via Nixpacks. Zero-config deployments for Node.js, PHP, Python, etc.",
	dockerfile:
		"Custom Dockerfile-based builds. Applications requiring specific OS dependencies or complex build stages.",
	dockercompose:
		"Multi-service deployments from a compose file. Complex apps with bundled databases, caches, or microservices.",
	dockerimage:
		"Deploy a pre-built Docker image from a registry. Pull and run an existing image without building from source.",
};

export const STATIC_FRAMEWORK_MAP = {
	vite: { name: "Vite", command: "npm run build", output: "dist" },
	"react-scripts": {
		name: "Create React App",
		command: "npm run build",
		output: "build",
	},
	next: { name: "Next.js", command: "npm run build", output: "out" },
	vue: { name: "Vue", command: "npm run build", output: "dist" },
	svelte: { name: "Svelte", command: "npm run build", output: "dist" },
	astro: { name: "Astro", command: "npm run build", output: "dist" },
	html: { name: "HTML", command: null, output: "." },
} as const;
