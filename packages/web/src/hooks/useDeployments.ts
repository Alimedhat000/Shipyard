import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Deployment {
	id: string;
	status: "pending" | "building" | "success" | "failed";
	prunedAt: string | null;
	createdAt: string;
}

interface DeploymentsResponse {
	deployments: Deployment[];
	activeDeploymentId: string | null;
}

export function useDeployments(appId: string, isOpen: boolean) {
	const query = useQuery<DeploymentsResponse>({
		queryKey: ["deployments", appId],
		queryFn: async () => {
			const res = await fetch(`/api/apps/${appId}/deployments`, {
				credentials: "include",
			});
			if (!res.ok) throw new Error("Failed to fetch deployments");
			return res.json();
		},
		enabled: isOpen,
		refetchInterval: isOpen ? 5000 : false,
		select: (data) => {
			if (Array.isArray(data)) {
				const list = data as unknown as Deployment[];
				return {
					deployments: list,
					activeDeploymentId: null,
				} as DeploymentsResponse;
			}
			return data as DeploymentsResponse;
		},
	});

	const deployments = query.data?.deployments ?? null;
	const activeDeploymentId = query.data?.activeDeploymentId ?? null;
	const latestDeployment = deployments?.[0] ?? null;

	return { ...query, data: deployments, latestDeployment, activeDeploymentId };
}

export function useDeployApp() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (appId: string) => {
			const res = await fetch(`/api/apps/${appId}/deployments`, {
				method: "POST",
				credentials: "include",
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? body.error ?? "Failed to deploy");
			}
			return res.json();
		},
		onSuccess: (_data, appId) => {
			qc.invalidateQueries({ queryKey: ["deployments", appId] });
		},
	});
}

export function useRollbackDeployment() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({
			deploymentId,
		}: {
			deploymentId: string;
			appId: string;
		}) => {
			const res = await fetch(`/api/deployments/${deploymentId}/rollback`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? "Failed to rollback");
			}
			return res.json();
		},
		onSuccess: (_data, variables) => {
			qc.invalidateQueries({ queryKey: ["deployments", variables.appId] });
		},
	});
}
