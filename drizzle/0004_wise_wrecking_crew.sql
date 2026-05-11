ALTER TABLE "apps" ADD COLUMN "install_command" varchar(500);--> statement-breakpoint
ALTER TABLE "deployment_logs" ADD COLUMN "step" varchar(50) NOT NULL;