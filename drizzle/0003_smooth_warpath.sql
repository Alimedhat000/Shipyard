CREATE TYPE "public"."build_pack" AS ENUM('nixpacks', 'static', 'dockerfile', 'dockercompose', 'dockerimage');--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "build_pack" "build_pack" DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "port" integer DEFAULT 80;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "run_command" varchar(500);--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "dockerfile_path" varchar(255) DEFAULT './Dockerfile';--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "is_spa" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "custom_nginx_config" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "image" varchar(500);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "detected_framework" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_apps_org_name_unique" ON "apps" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "framework";