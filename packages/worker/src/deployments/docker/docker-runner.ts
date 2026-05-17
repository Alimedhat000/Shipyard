import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import Docker from "dockerode";
import { logger } from "../../config/logger.js";

export type CreateContainerOptions = {
	image: string;
	memory: number;
	timeout: number;
	workspaceHost: string;
	workspaceContainer: string;
	labels: Record<string, string>;
	envVars: Record<string, string>;
};

export type ExecResult = {
	exitCode: number | null;
	oomKilled: boolean;
	stdout: string;
	stderr: string;
};

export type ManagedContainer = {
	containerId: string;
	deploymentId: string;
	workerId: string;
	createdAt: number;
};

/**
 * Resolves the most appropriate Docker host.
 * First checks DOCKER_HOST env var, then Rancher Desktop socket,
 * then the standard Docker socket.
 * @returns Docker client connected to the resolved socket
 */
function resolveDocker(): Docker {
	const dockerHost = process.env.DOCKER_HOST;
	if (dockerHost) {
		return new Docker({ host: dockerHost });
	}

	const candidates: { label: string; path: string }[] = [];
	if (process.env.DOCKER_HOST) {
		candidates.push({
			label: "DOCKER_HOST",
			path: process.env.DOCKER_HOST.replace("unix://", ""),
		});
	}
	candidates.push(
		{
			label: "Rancher Desktop",
			path: path.join(os.homedir(), ".rd", "docker.sock"),
		},
		{ label: "Standard socket", path: "/var/run/docker.sock" },
	);

	for (const c of candidates) {
		try {
			if (!fs.existsSync(c.path)) continue;
			logger.info(`Docker socket: ${c.label} (${c.path})`);
			return new Docker({ socketPath: c.path });
		} catch (err) {
			logger.warn({ err }, `Docker socket candidate ${c.label} failed`);
		}
	}

	throw new Error(
		"Docker socket not found. Set DOCKER_HOST or ensure /var/run/docker.sock exists.",
	);
}

/**
 * Manages the lifecycle of build containers via dockerode.
 *
 * Owns: create, exec, stop, remove, inspect, listManaged.
 * Commands inside the container run via /bin/sh -c.
 * The container stays alive with `sleep infinity` between step execs.
 */
export class DockerRunner {
	private docker: Docker;
	private resolvedNetwork: string | null = null;

	/**
	 * @param docker - Optional pre-configured Docker client. Omit to auto-detect socket.
	 */
	constructor(docker?: Docker) {
		this.docker = docker ?? resolveDocker();
	}

	/**
	 * Detects the Docker network the worker container is attached to.
	 *
	 * Inspects the current container (via hostname) and returns the first
	 * network found. This handles Docker Compose project name prefixes
	 * (e.g. "coolify_clone_shipyard" instead of just "shipyard").
	 *
	 * Falls back to "bridge" if detection fails.
	 */
	private async detectNetwork(): Promise<string> {
		if (this.resolvedNetwork) return this.resolvedNetwork;
		try {
			const hostname = os.hostname();
			const container = this.docker.getContainer(hostname);
			const info = await container.inspect();
			const networks = Object.keys(info.NetworkSettings?.Networks ?? {});
			if (networks.length > 0) {
				this.resolvedNetwork = networks[0];
				logger.debug(
					{ network: this.resolvedNetwork },
					"Detected worker network",
				);
				return this.resolvedNetwork;
			}
		} catch {
			// Not running inside a container — use fallback
		}
		this.resolvedNetwork = "bridge";
		return this.resolvedNetwork;
	}

	/**
	 * Ensures a Docker image is available locally — pulls if missing.
	 *
	 * Uses dockerode's callback-based pull with followProgress to
	 * guarantee the pull completes before resolving. Logs clearly on
	 * both pull and cache-hit paths so missing-image errors are
	 * distinguishable from container errors.
	 *
	 * @param image - Full image reference (e.g. "node:20-bookworm-slim")
	 * @throws Error if the image cannot be found in any registry
	 */
	async ensureImage(image: string): Promise<void> {
		try {
			await this.docker.getImage(image).inspect();
			logger.debug({ image }, "Image already cached locally");
			return;
		} catch {
			// Not present locally — pull it
		}

		return new Promise<void>((resolve, reject) => {
			logger.info({ image }, "Pulling missing image");

			this.docker.pull(image, (err: Error, stream: NodeJS.ReadableStream) => {
				if (err) {
					reject(new Error(`Failed to pull image '${image}': ${err.message}`));
					return;
				}

				this.docker.modem.followProgress(stream, (err) => {
					if (err) {
						reject(
							new Error(`Failed to pull image '${image}': ${err.message}`),
						);
					} else {
						logger.info({ image }, "Image pulled successfully");
						resolve();
					}
				});
			});
		});
	}

	/**
	 * Runs a single command in a fresh container and waits for it to finish.
	 *
	 * Container is created, started, waited on, then removed — fire-and-forget.
	 * Use this for one-shot steps (clone, copy) where you don't need
	 * a persistent build environment across multiple exec calls.
	 *
	 * The image entrypoint is cleared so that opts.cmd runs directly.
	 *
	 * @param opts.image - Docker image (e.g. "alpine/git")
	 * @param opts.cmd - Command to run (e.g. ["git", "clone", ...])
	 * @param opts.binds - Host-to-container bind mounts (e.g. ["/host:/container"])
	 * @param opts.env - Environment variables passed via -e
	 * @returns The exit code from the container
	 */
	async runOnce(opts: {
		image: string;
		cmd: string[];
		binds: string[];
		env: Record<string, string>;
	}): Promise<number> {
		await this.ensureImage(opts.image);
		logger.debug(
			{ image: opts.image, cmd: opts.cmd },
			"runOnce: creating container",
		);

		const container = await this.docker.createContainer({
			Image: opts.image,
			Cmd: opts.cmd,
			Entrypoint: [""],
			HostConfig: { Binds: opts.binds },
			Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`),
		});

		await container.start();
		const result = await container.wait();
		await container.remove().catch(() => {});

		logger.debug(
			{ image: opts.image, exitCode: result.StatusCode },
			"runOnce: container finished",
		);
		return result.StatusCode;
	}

	/**
	 * Creates and starts a build container.
	 *
	 * Container stays alive with `sleep infinity` so multiple exec calls
	 * can reuse the same filesystem, node_modules, and caches.
	 * Image is ensured locally before creation via ensureImage().
	 *
	 * @param opts.image - Docker image (e.g. "node:18-bullseye")
	 * @param opts.memory - Memory limit in bytes
	 * @param opts.timeout - Kill container after this many ms (0 = no timeout)
	 * @param opts.workspaceHost - Host path for bind mount
	 * @param opts.workspaceContainer - Container mount target (e.g. "/workspace")
	 * @param opts.labels - Docker labels for container tracking
	 * @param opts.envVars - Environment variables passed via -e
	 * @returns The started Docker container
	 */
	async create(opts: CreateContainerOptions) {
		await this.ensureImage(opts.image);
		const container = await this.docker.createContainer({
			Image: opts.image,
			Cmd: ["sleep", "infinity"],
			HostConfig: {
				Memory: opts.memory,
				MemorySwap: opts.memory,
				Binds: [`${opts.workspaceHost}:${opts.workspaceContainer}`],
			},
			Env: Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`),
			Labels: opts.labels,
		});

		await container.start();

		if (opts.timeout > 0) {
			setTimeout(() => {
				container.kill().catch(() => {});
			}, opts.timeout);
		}

		return container;
	}

	// -----------------------------------------------------------------------
	// Dockerfile / long-lived container helpers
	// -----------------------------------------------------------------------

	/**
	 * Builds a Docker image from a local context directory.
	 *
	 * Uses `docker build` via the host CLI, which is installed in the
	 * worker image. This is preferred over dockerode's buildImage
	 * because the CLI handles:
	 * - .dockerignore natively
	 * - progress output as plain text (loggable)
	 * - flags like --build-arg, --target, --platform
	 *
	 * @param opts.contextDir - Directory containing the Dockerfile and build context
	 * @param opts.dockerfile - Path to Dockerfile (absolute, inside contextDir)
	 * @param opts.tag - Image tag (e.g. "shipyard-app-123:deploy-456")
	 * @param opts.onData - Called with each build output chunk
	 * @throws Error if docker build exits with non-zero code
	 */
	async buildImage(opts: {
		contextDir: string;
		dockerfile: string;
		tag: string;
		onData?: (chunk: string) => void;
	}): Promise<void> {
		const relDockerfile = path.relative(opts.contextDir, opts.dockerfile);

		return new Promise<void>((resolve, reject) => {
			const proc = spawn(
				"docker",
				["build", "-f", relDockerfile, "-t", opts.tag, opts.contextDir],
				{
					cwd: opts.contextDir,
					stdio: ["ignore", "pipe", "pipe"],
				},
			);

			let stderr = "";

			proc.stdout?.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				opts.onData?.(text);
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				stderr += text;
				opts.onData?.(text);
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(
						new Error(
							`docker build exited with code ${code}: ${stderr.slice(0, 500)}`,
						),
					);
				}
			});

			proc.on("error", reject);
		});
	}

	/**
	 * Creates and starts a long-lived container (for dockerfile / dockerimage
	 * build packs). Unlike create(), this does NOT use "sleep infinity" —
	 * the container runs whatever CMD/ENTRYPOINT the image defines.
	 *
	 * Container is auto-restarted on crash (restart policy: unless-stopped)
	 * and the configured port is mapped to the same port on the host.
	 *
	 * @param opts.image - Docker image to run (already built or pulled)
	 * @param opts.containerName - Name assigned to the container
	 * @param opts.port - Container port to expose and map
	 * @param opts.envVars - Environment variables passed via -e
	 * @param opts.labels - Docker labels for container tracking
	 * @returns The started Docker container
	 */
	async runLongLived(opts: {
		image: string;
		containerName: string;
		containerPort: number;
		envVars: Record<string, string>;
		labels: Record<string, string>;
	}): Promise<number> {
		const network = await this.detectNetwork();

		const container = await this.docker.createContainer({
			name: opts.containerName,
			Image: opts.image,
			ExposedPorts: { [`${opts.containerPort}/tcp`]: {} },
			HostConfig: {
				PortBindings: {
					[`${opts.containerPort}/tcp`]: [{}],
				},
				RestartPolicy: { Name: "unless-stopped" },
			},
			Env: Object.entries(opts.envVars).map(([k, v]) => `${k}=${v}`),
			Labels: opts.labels,
			NetworkingConfig: {
				EndpointsConfig: {
					[network]: {},
				},
			},
		});

		await container.start();

		const info = await container.inspect();
		const portKey = `${opts.containerPort}/tcp`;
		const hostPort = info.NetworkSettings?.Ports?.[portKey]?.[0]?.HostPort;

		if (!hostPort) {
			throw new Error(
				`Failed to get mapped host port for container port ${opts.containerPort}`,
			);
		}

		return Number(hostPort);
	}

	/**
	 * Stops and removes a container by name.
	 *
	 * Best-effort — if no container with this name exists, it's a no-op.
	 * Errors are logged but not thrown (cleanup).
	 *
	 * @param containerName - Name of the container to stop and remove
	 */
	async stopByName(containerName: string) {
		const container = this.docker.getContainer(containerName);

		try {
			await container.stop({ t: 5 });
		} catch (err: unknown) {
			const statusCode = (err as Record<string, unknown>)?.statusCode;
			if (statusCode !== 304) {
				logger.warn({ err, containerName }, "Failed to stop container by name");
			}
		}

		try {
			await container.remove({ force: true });
		} catch (err: unknown) {
			const statusCode = (err as Record<string, unknown>)?.statusCode;
			if (statusCode !== 404) {
				logger.warn(
					{ err, containerName },
					"Failed to remove container by name",
				);
			}
		}
	}

	/**
	 * Prunes old Docker image tags for an app, keeping only the current one.
	 *
	 * Each dockerfile deploy creates a new tag (shipyard-{appId}:{deploymentId}).
	 * Docker's layer cache means all tags point at the same image, but old tags
	 * accumulate unboundedly. This removes all tags for an app except the one
	 * just created.
	 *
	 * Best-effort — errors are logged but not thrown. Handles concurrent
	 * prunes gracefully (404 = already removed by another worker).
	 *
	 * @param appId - App ID used in the tag prefix
	 * @param keepTag - Full image reference to keep (e.g. "shipyard-abc:deploy-123")
	 */
	async pruneOldImageTags(appId: string, keepTag: string): Promise<void> {
		try {
			const images = await this.docker.listImages({
				filters: { reference: [`shipyard-${appId}`] },
			});

			for (const img of images) {
				for (const tag of img.RepoTags ?? []) {
					if (tag.startsWith(`shipyard-${appId}:`) && tag !== keepTag) {
						try {
							await this.docker.getImage(tag).remove();
							logger.debug({ tag }, "Pruned old image tag");
						} catch {
							// 404 = already removed by concurrent prune
						}
					}
				}
			}
		} catch (err) {
			logger.warn({ err, appId }, "Failed to list images for pruning");
		}
	}

	/**
	 * Runs a command inside a build container.
	 *
	 * Streams stdout/stderr to the onData callback (for log capture),
	 * then returns the combined output, exit code, and OOM status.
	 *
	 * @param containerId - Docker container ID
	 * @param command - Shell command to run (via /bin/sh -c)
	 * @param onData - Called with each stdout/stderr chunk for streaming
	 * @returns Exit code, OOM flag, and accumulated stdout/stderr
	 */
	async exec(
		containerId: string,
		command: string,
		onData?: (chunk: string) => void,
	): Promise<ExecResult> {
		const container = this.docker.getContainer(containerId);

		const exec = await container.exec({
			Cmd: ["/bin/sh", "-c", command],
			AttachStdout: true,
			AttachStderr: true,
		});

		const stream = await exec.start({ hijack: true, stdin: false });

		return new Promise<ExecResult>((resolve, reject) => {
			let stdout = "";
			let stderr = "";

			const outStream = new Writable({
				write(chunk: Buffer, _encoding, callback) {
					const text = chunk.toString();
					stdout += text;
					onData?.(text);
					callback();
				},
			});

			const errStream = new Writable({
				write(chunk: Buffer, _encoding, callback) {
					const text = chunk.toString();
					stderr += text;
					onData?.(text);
					callback();
				},
			});

			container.modem.demuxStream(stream, outStream, errStream);

			stream.on("end", async () => {
				try {
					const [execInfo, containerInfo] = await Promise.all([
						exec.inspect(),
						container.inspect(),
					]);
					resolve({
						exitCode: execInfo.ExitCode,
						oomKilled: containerInfo.State.OOMKilled ?? false,
						stdout,
						stderr,
					});
				} catch (err) {
					reject(err);
				}
			});

			stream.on("error", reject);
		});
	}

	/**
	 * Gracefully stops a container (5s timeout before force kill).
	 * Failures are logged but not thrown (best-effort cleanup).
	 */
	async stop(containerId: string) {
		const container = this.docker.getContainer(containerId);
		try {
			await container.stop({ t: 5 });
		} catch (err) {
			logger.warn(
				{ err },
				`Failed to stop container ${containerId.slice(0, 12)}`,
			);
		}
	}

	/**
	 * Force-removes a container. Failures are logged but not thrown
	 * (best-effort cleanup).
	 */
	async remove(containerId: string) {
		const container = this.docker.getContainer(containerId);
		try {
			await container.remove({ force: true });
		} catch (err) {
			logger.warn(
				{ err },
				`Failed to remove container ${containerId.slice(0, 12)}`,
			);
		}
	}

	/**
	 * Inspects a container's current state (exit code, OOM, etc.).
	 */
	async inspect(containerId: string) {
		return this.docker.getContainer(containerId).inspect();
	}

	/**
	 * Lists all managed build containers (labelled shipyard.managed=true).
	 * Used during startup reconciliation to clean up orphaned containers.
	 */
	async listManaged(): Promise<ManagedContainer[]> {
		const containers = await this.docker.listContainers({
			all: true,
			filters: { label: ["shipyard.managed=true"] },
		});

		const result: ManagedContainer[] = [];
		for (const c of containers) {
			const labels = c.Labels ?? {};
			const deploymentId = labels["shipyard.deployment-id"];
			if (!deploymentId) continue;
			result.push({
				containerId: c.Id,
				deploymentId,
				workerId: labels["shipyard.worker-id"] ?? "unknown",
				createdAt: c.Created ?? 0,
			});
		}
		return result;
	}
}
