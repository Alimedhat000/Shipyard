export type DeploymentJob = {
	type: "deploy" | "rollback";
	deploymentId: string;
	applicationId: string;
	titleLog: string;
	descriptionLog: string;
};
