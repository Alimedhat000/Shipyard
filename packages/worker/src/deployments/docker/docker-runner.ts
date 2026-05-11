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

export class DockerRunner {
	private docker: Docker;

	constructor(docker?: Docker) {
		this.docker = docker ?? resolveDocker();
	}

	async create(opts: CreateContainerOptions) {
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

	async inspect(containerId: string) {
		return this.docker.getContainer(containerId).inspect();
	}

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
