import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useApps() {
	return useQuery({
		queryKey: ["apps"],
		queryFn: async () => {
			const res = await fetch("/api/apps", { credentials: "include" });
			if (!res.ok) throw new Error("Failed to fetch apps");
			return res.json();
		},
	});
}

export function useCreateApp() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (data: Record<string, unknown>) => {
			const res = await fetch("/api/apps", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(data),
			});
			const body = await res.json();
			if (!res.ok)
				throw new Error(body.message ?? body.error ?? "Failed to create app");
			return body;
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
	});
}

export function useDeleteApp() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (id: string) => {
			const res = await fetch(`/api/apps/${id}`, {
				method: "DELETE",
				credentials: "include",
			});
			if (!res.ok) throw new Error("Failed to delete app");
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
	});
}
