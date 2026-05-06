import { useQuery, useQueryClient } from "@tanstack/react-query";

export function useAuth() {
	return useQuery({
		queryKey: ["auth", "me"],
		queryFn: async () => {
			const res = await fetch("/api/auth/me", {
				credentials: "include",
			});
			if (res.status === 401 || res.status === 403) return null;
			if (!res.ok) throw new Error("Failed to fetch user");
			return res.json(); // { user, organization } | null
		},
		retry: false,
		staleTime: 5 * 60 * 1000,
	});
}

export function useLogout() {
	const qc = useQueryClient();
	return async () => {
		await fetch("/api/auth/logout", {
			method: "POST",
			credentials: "include",
		});
		qc.setQueryData(["auth", "me"], null);
		window.location.href = "/login";
	};
}
