ALTER TABLE "apps" ALTER COLUMN "build_pack" SET DEFAULT 'nixpacks';--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "is_static" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "public"."apps" ALTER COLUMN "build_pack" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."build_pack";--> statement-breakpoint
CREATE TYPE "public"."build_pack" AS ENUM('nixpacks', 'dockerfile', 'dockercompose', 'dockerimage');--> statement-breakpoint
ALTER TABLE "public"."apps" ALTER COLUMN "build_pack" SET DATA TYPE "public"."build_pack" USING "build_pack"::"public"."build_pack";