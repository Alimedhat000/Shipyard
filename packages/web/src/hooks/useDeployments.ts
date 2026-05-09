import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Deployment {
	id: string;
	status: "pending" | "building" | "success" | "failed";
	createdAt: string;
}

export function useDeployments(appId: string, isOpen: boolean) {
	const query = useQuery<Deployment[]>({
		queryKey: ["deployments", appId],
		queryFn: async () => {
			const res = await fetch(`/api/apps/${appId}/deployments`, {
				credentials: "include",
			});
			if (!res.ok) throw new Error("Failed to fetch deployments");
			return res.json();
		},
		refetchInterval: (q) => {
			if (!isOpen) return false;
			const data = q.state.data;
			if (!data) return false;
			const hasActive = data.some(
				(d) => d.status === "pending" || d.status === "building",
			);
			return hasActive ? 3000 : false;
		},
	});

	const latestDeployment = query.data?.[0] ?? null;

	return { ...query, latestDeployment };
}

export function useDeployApp() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (appId: string) => {
			const res = await fetch(`/api/apps/${appId}/deployments`, {
				method: "POST",
				credentials: "include",
			});
			const body = await res.json();
			if (!res.ok)
				throw new Error(body.message ?? body.error ?? "Failed to deploy");
			return body;
		},
		onSuccess: (_data, appId) => {
			qc.invalidateQueries({ queryKey: ["deployments", appId] });
		},
	});
}
