-- Add cascade delete to foreign keys
ALTER TABLE deployments DROP CONSTRAINT deployments_app_id_apps_id_fk;
ALTER TABLE deployments ADD CONSTRAINT deployments_app_id_apps_id_fk
  FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;

ALTER TABLE build_jobs DROP CONSTRAINT build_jobs_deployment_id_deployments_id_fk;
ALTER TABLE build_jobs ADD CONSTRAINT build_jobs_deployment_id_deployments_id_fk
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE;

ALTER TABLE deployment_logs DROP CONSTRAINT deployment_logs_deployment_id_deployments_id_fk;
ALTER TABLE deployment_logs ADD CONSTRAINT deployment_logs_deployment_id_deployments_id_fk
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE;

ALTER TABLE deployment_files DROP CONSTRAINT deployment_files_deployment_id_deployments_id_fk;
ALTER TABLE deployment_files ADD CONSTRAINT deployment_files_deployment_id_deployments_id_fk
  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE;