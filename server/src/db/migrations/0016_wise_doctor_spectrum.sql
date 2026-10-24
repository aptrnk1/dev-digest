ALTER TABLE "onboarding" ALTER COLUMN "json" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ALTER COLUMN "generated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "onboarding" ALTER COLUMN "generated_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "status" text DEFAULT 'running' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "run_id" uuid DEFAULT gen_random_uuid() NOT NULL;