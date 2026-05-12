ALTER TABLE "build_jobs" DROP CONSTRAINT "build_jobs_deployment_id_deployments_id_fk";
--> statement-breakpoint
ALTER TABLE "deployment_files" DROP CONSTRAINT "deployment_files_deployment_id_deployments_id_fk";
--> statement-breakpoint
ALTER TABLE "deployment_logs" DROP CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk";
--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_app_id_apps_id_fk";
--> statement-breakpoint
ALTER TABLE "build_jobs" ADD CONSTRAINT "build_jobs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_files" ADD CONSTRAINT "deployment_files_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD CONSTRAINT "deployment_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;