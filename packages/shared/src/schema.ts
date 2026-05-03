import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

export const organizations = pgTable(
	"organizations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: varchar("name", { length: 255 }).notNull(),
		slug: varchar("slug", { length: 255 }).notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		slugIdx: index("idx_organizations_slug").on(table.slug),
	}),
);

export const users = pgTable(
	"users",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		githubId: varchar("github_id", { length: 255 }).notNull().unique(),
		githubUsername: varchar("github_username", { length: 255 }).notNull(),
		githubAccessToken: text("github_access_token"),
		email: varchar("email", { length: 255 }),
		avatarUrl: varchar("avatar_url", { length: 500 }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		githubIdIdx: index("idx_users_github_id").on(table.githubId),
	}),
);

export const organizationMembers = pgTable(
	"organization_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.references(() => users.id)
			.notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id)
			.notNull(),
		role: varchar("role", { length: 50 }).notNull().default("member"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index("idx_org_members_user_id").on(table.userId),
		organizationIdIdx: index("idx_org_members_org_id").on(table.organizationId),
	}),
);

export const apps = pgTable(
	"apps",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: varchar("name", { length: 255 }).notNull(),
		organizationId: uuid("organization_id")
			.references(() => organizations.id)
			.notNull(),
		githubRepo: varchar("github_repo", { length: 500 }).notNull(),
		buildCommand: varchar("build_command", { length: 500 }),
		outputDir: varchar("output_dir", { length: 255 }),
		framework: varchar("framework", { length: 100 }),
		branch: varchar("branch", { length: 100 }).default("main"),
		buildTimeout: integer("build_timeout").default(900),
		activeDeploymentId: uuid("active_deployment_id"),
		webhookSecret: varchar("webhook_secret", { length: 255 }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at"),
	},
	(table) => ({
		orgIdIdx: index("idx_apps_org_id").on(table.organizationId),
	}),
);

export const deployments = pgTable(
	"deployments",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		appId: uuid("app_id")
			.references(() => apps.id)
			.notNull(),
		commitSha: varchar("commit_sha", { length: 255 }),
		commitMessage: text("commit_message"),
		branch: varchar("branch", { length: 100 }),
		status: varchar("status", { length: 50 }).notNull().default("pending"),
		outputDir: varchar("output_dir", { length: 255 }),
		startedAt: timestamp("started_at"),
		finishedAt: timestamp("finished_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		appIdIdx: index("idx_deployments_app_id").on(table.appId),
		statusIdx: index("idx_deployments_status").on(table.status),
	}),
);

export const buildJobs = pgTable(
	"build_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deploymentId: uuid("deployment_id")
			.references(() => deployments.id)
			.notNull(),
		step: varchar("step", { length: 50 }).notNull(),
		status: varchar("status", { length: 50 }).notNull().default("pending"),
		attempts: integer("attempts").default(0),
		workerId: varchar("worker_id", { length: 255 }),
		startedAt: timestamp("started_at"),
		finishedAt: timestamp("finished_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		deploymentIdIdx: index("idx_build_jobs_deployment_id").on(
			table.deploymentId,
		),
	}),
);

export const deploymentLogs = pgTable(
	"deployment_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deploymentId: uuid("deployment_id")
			.references(() => deployments.id)
			.notNull(),
		content: text("content").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		deploymentIdIdx: index("idx_deployment_logs_deployment_id").on(
			table.deploymentId,
		),
	}),
);

export const envVars = pgTable(
	"env_vars",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		appId: uuid("app_id")
			.references(() => apps.id)
			.notNull(),
		key: varchar("key", { length: 255 }).notNull(),
		value: text("value").notNull(),
		isSecret: boolean("is_secret").default(false),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		appIdIdx: index("idx_env_vars_app_id").on(table.appId),
	}),
);

export const deploymentFiles = pgTable(
	"deployment_files",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deploymentId: uuid("deployment_id")
			.references(() => deployments.id)
			.notNull(),
		filePath: varchar("file_path", { length: 1000 }).notNull(),
		contentHash: varchar("content_hash", { length: 255 }),
		fileSize: integer("file_size"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		deploymentIdIdx: index("idx_deployment_files_deployment_id").on(
			table.deploymentId,
		),
	}),
);

export const domains = pgTable(
	"domains",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		appId: uuid("app_id")
			.references(() => apps.id)
			.notNull(),
		domain: varchar("domain", { length: 255 }).notNull().unique(),
		isPrimary: boolean("is_primary").default(false),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		appIdIdx: index("idx_domains_app_id").on(table.appId),
		domainIdx: index("idx_domains_domain").on(table.domain),
	}),
);

export const sessions = pgTable(
	"sessions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.references(() => users.id)
			.notNull(),
		token: varchar("token", { length: 255 }).notNull().unique(),
		expiresAt: timestamp("expires_at").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		userIdIdx: index("idx_sessions_user_id").on(table.userId),
		tokenIdx: index("idx_sessions_token").on(table.token),
	}),
);

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type App = typeof apps.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type BuildJob = typeof buildJobs.$inferSelect;
export type DeploymentLog = typeof deploymentLogs.$inferSelect;
export type EnvVar = typeof envVars.$inferSelect;
export type DeploymentFile = typeof deploymentFiles.$inferSelect;
export type Domain = typeof domains.$inferSelect;
export type Session = typeof sessions.$inferSelect;
